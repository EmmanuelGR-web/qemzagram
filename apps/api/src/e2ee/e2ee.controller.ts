import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  e2eeKeyLookupSchema,
  e2eePublishKeySchema,
  type ConversationKeysDto,
  type E2eeKeyDto,
  type E2eePublishKeyInput,
  type MyE2eeKeyDto,
} from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { E2eeService } from './e2ee.service';

@Controller('e2ee')
export class E2eeController {
  constructor(private readonly e2ee: E2eeService) {}

  /** Mi clave activa y su copia cifrada (para abrirla en un dispositivo nuevo con el código). */
  @Get('keys/me')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  mine(@CurrentUser() user: AuthUser): Promise<MyE2eeKeyDto> {
    return this.e2ee.mine(user.id);
  }

  @Post('keys')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  publish(@CurrentUser() user: AuthUser, @Body(new ZodPipe(e2eePublishKeySchema)) body: E2eePublishKeyInput): Promise<MyE2eeKeyDto> {
    return this.e2ee.publish(user.id, body);
  }

  @Post('keys/lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  lookup(@CurrentUser() user: AuthUser, @Body(new ZodPipe(e2eeKeyLookupSchema)) body: { ids: string[] }): Promise<E2eeKeyDto[]> {
    return this.e2ee.lookup(user.id, body.ids);
  }

  @Get('conversations/:id/keys')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  conversationKeys(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ConversationKeysDto> {
    return this.e2ee.conversationKeys(user.id, id);
  }
}
