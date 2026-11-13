import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { pushSubscriptionSchema, pushUnsubscribeSchema, type PushConfigDto, type PushSubscriptionInput } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Clave pública VAPID que necesita el navegador para suscribirse. */
  @Get('config')
  config(): PushConfigDto {
    return this.push.config();
  }

  /** Activa las notificaciones en ESTE dispositivo. */
  @Post('subscriptions')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  subscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(pushSubscriptionSchema)) body: PushSubscriptionInput): Promise<void> {
    return this.push.subscribe(user.id, body);
  }

  /** Desactiva las notificaciones en ESTE dispositivo (también al cerrar sesión). */
  @Post('subscriptions/remove')
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(pushUnsubscribeSchema)) body: { endpoint: string }): Promise<void> {
    return this.push.unsubscribe(user.id, body.endpoint);
  }
}
