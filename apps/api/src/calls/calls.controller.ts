import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { startCallSchema, type CallDto, type CallJoinDto, type StartCallInput } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CallsService } from './calls.service';

@Controller()
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /** Llamar desde un chat (1 a 1 o grupo). */
  @Post('chats/:id/calls')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(startCallSchema)) body: StartCallInput): Promise<CallJoinDto> {
    return this.calls.start(user.id, id, body.kind);
  }

  /** Llamadas en curso en mis chats. */
  @Get('calls/active')
  listOpen(@CurrentUser() user: AuthUser): Promise<CallDto[]> {
    return this.calls.listOpen(user.id);
  }

  @Get('calls/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CallDto> {
    return this.calls.get(user.id, id);
  }

  /** Atender o sumarse: devuelve un token de vida corta para entrar a la sala de medios. */
  @Post('calls/:id/join')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  join(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CallJoinDto> {
    return this.calls.join(user.id, id);
  }

  @Post('calls/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CallDto> {
    return this.calls.decline(user.id, id);
  }

  @Post('calls/:id/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CallDto> {
    return this.calls.leave(user.id, id);
  }
}
