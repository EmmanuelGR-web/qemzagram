import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { POW_HEADER, type PowPurpose } from '@qemzagram/shared';
import type { Request } from 'express';
import { PowService } from './pow.service';

const POW_PURPOSE_KEY = 'powPurpose';

/** Marca una ruta pública que exige resolver la prueba de trabajo (anti-bots) para ese propósito. */
export const RequiresPow = (purpose: PowPurpose) => SetMetadata(POW_PURPOSE_KEY, purpose);

/** Corre después de los guards globales (límite → origen → sesión). Sin la marca, no hace nada. */
@Injectable()
export class PowGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly pow: PowService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const purpose = this.reflector.get<PowPurpose | undefined>(POW_PURPOSE_KEY, context.getHandler());
    if (!purpose) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[POW_HEADER];
    await this.pow.verify(typeof header === 'string' ? header : undefined, purpose);
    return true;
  }
}
