import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../common/decorators';

/**
 * Solo el rol "support" entra al panel. Corre DESPUÉS de los guards globales (sesión válida),
 * y el rol viene de la base en cada petición (JwtAuthGuard), no del token.
 * A cualquier otra persona se le responde "no encontrado": ni siquiera se revela que el panel existe.
 */
@Injectable()
export class SupportGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (request.user?.role !== 'support') throw new NotFoundException({ code: 'NOT_FOUND', message: 'No encontrado' });
    return true;
  }
}
