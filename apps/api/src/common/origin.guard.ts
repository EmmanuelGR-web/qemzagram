import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type AppEnv } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa anti-CSRF: toda petición que modifica datos debe venir de nuestra propia web.
 * (Se suma a las cookies SameSite=Strict.)
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    if (origin) {
      if (origin !== this.env.WEB_ORIGIN) throw new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED', message: 'Origen no permitido' });
      return true;
    }
    // Sin cabecera Origin: solo se acepta si no hay cookies (no es una sesión de navegador).
    if (request.headers.cookie) throw new ForbiddenException({ code: 'ORIGIN_REQUIRED', message: 'Origen requerido' });
    return true;
  }
}
