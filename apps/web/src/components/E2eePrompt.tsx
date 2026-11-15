'use client';

import { useE2ee } from '@/lib/e2ee-context';
import { E2eeDialog } from './E2eeDialog';

/** Al entrar a la app: si la cuenta no tiene claves (o este dispositivo no las tiene), lo pide una vez por sesión. */
export function E2eePrompt() {
  const { status, dismissed, dismiss } = useE2ee();
  if (dismissed || (status !== 'missing' && status !== 'locked')) return null;
  return <E2eeDialog mode={status === 'missing' ? 'create' : 'unlock'} onClose={dismiss} />;
}
