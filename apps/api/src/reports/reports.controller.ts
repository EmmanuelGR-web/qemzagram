import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createReportSchema, type CreateReportInput, type MyReportDto } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createReportSchema)) body: CreateReportInput): Promise<MyReportDto> {
    return this.reports.create(user.id, body);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser): Promise<MyReportDto[]> {
    return this.reports.listMine(user.id);
  }
}
