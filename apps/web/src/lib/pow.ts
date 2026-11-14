import { POW_HEADER, solvePowChunk, type PowChallengeDto, type PowPurpose } from '@qemzagram/shared';
import { api, ApiError } from './api';

const CHUNK = 4000;
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Resuelve la prueba anti-bots: pide un desafío y busca el número que cumple la dificultad,
 * en tandas cortas para que la pantalla no se congele. Suele tardar 1–2 segundos.
 */
export async function solvePow(purpose: PowPurpose): Promise<string> {
  const dto = await api<PowChallengeDto>(`/auth/pow?purpose=${purpose}`);
  for (let start = 0; ; start += CHUNK) {
    const nonce = solvePowChunk(dto.challenge, dto.difficulty, start, CHUNK);
    if (nonce !== null) return `${dto.challenge}:${nonce}`;
    await yieldToBrowser();
  }
}

/** Llama a una ruta pública protegida con la prueba anti-bots (si el desafío venció, reintenta una vez). */
export async function protectedApi<T = void>(purpose: PowPurpose, path: string, body: unknown): Promise<T> {
  try {
    return await api<T>(path, { body, headers: { [POW_HEADER]: await solvePow(purpose) } });
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'POW_INVALID' || error.code === 'POW_REQUIRED')) {
      return api<T>(path, { body, headers: { [POW_HEADER]: await solvePow(purpose) } });
    }
    throw error;
  }
}
