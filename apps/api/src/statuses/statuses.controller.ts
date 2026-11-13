import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createTextStatusSchema, type CreateTextStatusInput, type StatusDto, type StatusOverviewDto } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { StatusesService } from './statuses.service';

@Controller('statuses')
export class StatusesController {
  constructor(private readonly statuses: StatusesService) {}

  /** Tus estados vigentes + los de tu agenda que podés ver. */
  @Get()
  overview(@CurrentUser() user: AuthUser): Promise<StatusOverviewDto> {
    return this.statuses.overview(user.id);
  }

  @Post('text')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createText(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createTextStatusSchema)) body: CreateTextStatusInput): Promise<StatusDto> {
    return this.statuses.createText(user.id, body);
  }
}
