import type { BlockedUserDto } from '@qemzagram/shared';
import { api } from './api';

export function listBlocked(): Promise<BlockedUserDto[]> {
  return api<BlockedUserDto[]>('/blocks');
}

export async function blockUser(userId: string): Promise<void> {
  await api('/blocks', { body: { userId } });
}

export async function unblockUser(userId: string): Promise<void> {
  await api(`/blocks/${userId}`, { method: 'DELETE' });
}

/** Texto de confirmación: explica qué pasa al bloquear (sin sorpresas). */
export const BLOCK_EXPLANATION =
  'No va a poder escribirte, llamarte, agregarte ni ver tus estados, y para esa persona vas a desaparecer de "Personas cercanas". No se le avisa. Podés desbloquearla cuando quieras desde Ajustes.';
