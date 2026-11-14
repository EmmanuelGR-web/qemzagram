import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { blockUserSchema, type BlockedUserDto } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BlocksService } from './blocks.service';

@Controller('blocks')
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<BlockedUserDto[]> {
    return this.blocks.list(user.id);
  }

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  block(@CurrentUser() user: AuthUser, @Body(new ZodPipe(blockUserSchema)) body: { userId: string }): Promise<void> {
    return this.blocks.block(user.id, body.userId);
  }

  @Delete(':userId')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  unblock(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.blocks.unblock(user.id, userId);
  }
}
