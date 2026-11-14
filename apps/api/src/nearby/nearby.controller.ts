import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  nearbyGreetSchema,
  nearbyPresenceSchema,
  type ContactDto,
  type NearbyCell,
  type NearbyGreetResultDto,
  type NearbyGreetingsDto,
  type NearbyPersonDto,
  type NearbyStatusDto,
} from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { GreetingsService } from './greetings.service';
import { NearbyService } from './nearby.service';

@Controller('nearby')
export class NearbyController {
  constructor(
    private readonly nearby: NearbyService,
    private readonly greetings: GreetingsService,
  ) {}

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

  @Get('greetings')
  greetingsList(@CurrentUser() user: AuthUser): Promise<NearbyGreetingsDto> {
    return this.greetings.list(user.id);
  }

  /** Saludar a alguien que aparece en tu lista de cercanos. */
  @Post('greetings')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  greet(@CurrentUser() user: AuthUser, @Body(new ZodPipe(nearbyGreetSchema)) body: { userId: string }): Promise<NearbyGreetResultDto> {
    return this.greetings.greet(user.id, body.userId);
  }

  @Post('greetings/:id/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ContactDto> {
    return this.greetings.accept(user.id, id);
  }

  @Post('greetings/:id/decline')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.greetings.decline(user.id, id);
  }
}
