import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { nearbyPresenceSchema, type NearbyCell, type NearbyPersonDto, type NearbyStatusDto } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { NearbyService } from './nearby.service';

@Controller('nearby')
export class NearbyController {
  constructor(private readonly nearby: NearbyService) {}

  @Get()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  list(@CurrentUser() user: AuthUser): Promise<NearbyPersonDto[]> {
    return this.nearby.list(user.id);
  }

  @Get('me')
  status(@CurrentUser() user: AuthUser): Promise<NearbyStatusDto> {
    return this.nearby.status(user.id);
  }

  /** Activar o renovar la visibilidad (opt-in explícito: `consent: true`). Solo recibe una celda de ~1 km. */
  @Put('me')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  show(@CurrentUser() user: AuthUser, @Body(new ZodPipe(nearbyPresenceSchema)) body: { cell: NearbyCell; consent: true }): Promise<NearbyStatusDto> {
    return this.nearby.show(user.id, body.cell);
  }

  /** Modo invisible (borra la celda guardada). */
  @Delete('me')
  @HttpCode(204)
  hide(@CurrentUser() user: AuthUser): Promise<void> {
    return this.nearby.hide(user.id);
  }
}
