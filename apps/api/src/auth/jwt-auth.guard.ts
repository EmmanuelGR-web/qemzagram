import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, type AuthedRequest } from '../common/decorators';
import { UsersRepository } from '../database/repositories/users.repository';
import { ACCESS_COOKIE } from './auth.constants';
import { TokensService } from './tokens.service';

/** Guard global: TODA ruta exige sesión salvo que esté marcada con @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Iniciá sesión para continuar' });

    const userId = await this.tokens.verifyAccess(token);
    const user = await this.users.findById(userId);
    // Se consulta la base en cada petición: un usuario baneado/pausado pierde acceso al instante.
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sesión inválida o vencida' });
    }
    request.user = { id: user.id, tag: user.tag, role: user.role };
    return true;
  }
}
