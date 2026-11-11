import type { ApiErrorBody } from '@qemzagram/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
}

let refreshing: Promise<boolean> | null = null;

/** Renueva la sesión una sola vez aunque varias peticiones fallen a la vez. */
function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

export async function api<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined || options.form !== undefined;
  const send = () =>
    fetch(`/api${path}`, {
      method: options.method ?? (hasBody ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });

  let response = await send();
  const isAuthRoute = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
  if (response.status === 401 && !isAuthRoute && (await tryRefresh())) response = await send();

  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as (Partial<ApiErrorBody> & Record<string, unknown>) | null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.code ?? 'ERROR', data?.message ?? 'Ocurrió un error. Probá de nuevo.', data?.issues ?? []);
  }
  return data as T;
}

/** Renueva la sesión (p. ej. cuando una imagen falló porque venció la cookie de acceso). */
export const refreshSession = tryRefresh;

/** Las imágenes las sirve la API; se piden por el mismo origen vía /api. */
export function mediaUrl(path: string | null | undefined): string | null {
  return path ? `/api${path}` : null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.issues.length > 0 ? error.issues.map((issue) => issue.message).join('. ') : error.message;
  }
  return 'No pudimos conectar con el servidor. Revisá tu conexión.';
}
