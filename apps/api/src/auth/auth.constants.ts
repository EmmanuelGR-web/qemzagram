export const ACCESS_COOKIE = 'qz_at';
export const REFRESH_COOKIE = 'qz_rt';

export const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutos
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días
export const WS_TICKET_TTL_SECONDS = 60;

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export const JWT_ISSUER = 'qemzagram';
export const AUDIENCE_ACCESS = 'qz:access';
export const AUDIENCE_WS = 'qz:ws';
