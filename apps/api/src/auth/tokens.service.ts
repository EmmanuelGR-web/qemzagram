import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ENV, type AppEnv } from '../config/env';
import { ACCESS_TTL_SECONDS, AUDIENCE_ACCESS, AUDIENCE_WS, JWT_ISSUER, WS_TICKET_TTL_SECONDS } from './auth.constants';

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  signAccess(userId: string): Promise<string> {
    return this.jwt.signAsync(
      {},
      {
        subject: userId,
        secret: this.env.JWT_ACCESS_SECRET,
        expiresIn: ACCESS_TTL_SECONDS,
        audience: AUDIENCE_ACCESS,
        issuer: JWT_ISSUER,
        algorithm: 'HS256',
      },
    );
  }

  async verifyAccess(token: string): Promise<string> {
    return this.verify(token, this.env.JWT_ACCESS_SECRET, AUDIENCE_ACCESS);
  }

  /** Ticket de vida corta para abrir el WebSocket sin exponer la cookie de sesión. */
  signWsTicket(userId: string): Promise<string> {
    return this.jwt.signAsync(
      {},
      {
        subject: userId,
        secret: this.env.JWT_TICKET_SECRET,
        expiresIn: WS_TICKET_TTL_SECONDS,
        audience: AUDIENCE_WS,
        issuer: JWT_ISSUER,
        algorithm: 'HS256',
      },
    );
  }

  verifyWsTicket(ticket: string): Promise<string> {
    return this.verify(ticket, this.env.JWT_TICKET_SECRET, AUDIENCE_WS);
  }

  private async verify(token: string, secret: string, audience: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(token, {
        secret,
        audience,
        issuer: JWT_ISSUER,
        algorithms: ['HS256'], // fija el algoritmo: evita ataques "alg: none"
      });
      if (!payload.sub) throw new Error('sin sujeto');
      return payload.sub;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sesión inválida o vencida' });
    }
  }
}
