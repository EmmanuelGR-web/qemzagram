import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca una ruta como pública (no exige sesión). Por defecto TODAS las rutas exigen sesión. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthUser {
  id: string;
  tag: string;
  role: 'user' | 'support';
  mfaEnabled: boolean;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  if (!request.user) throw new Error('CurrentUser usado en una ruta sin autenticación');
  return request.user;
});

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export function clientMeta(request: Request): ClientMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
  };
}
