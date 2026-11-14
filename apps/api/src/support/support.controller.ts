import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  resolveAppealSchema,
  resolveReportSchema,
  supportAppealsQuerySchema,
  supportReportsQuerySchema,
  supportUserLookupSchema,
  type ResolveAppealInput,
  type ResolveReportInput,
  type ResolveReportResultDto,
  type SupportAppealDto,
  type SupportReportDetailDto,
  type SupportReportDto,
  type SupportStatsDto,
  type SupportUserDto,
} from '@qemzagram/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SupportGuard } from './support.guard';
import { SupportService } from './support.service';

/**
 * Panel de soporte. TODAS las rutas exigen sesión (guard global) y rol "support" (SupportGuard).
 * No existe ninguna ruta que devuelva mensajes o conversaciones.
 */
@Controller('support')
@UseGuards(SupportGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('stats')
  stats(): Promise<SupportStatsDto> {
    return this.support.getStats();
  }

  @Get('reports')
  listReports(@Query(new ZodPipe(supportReportsQuerySchema)) query: z.infer<typeof supportReportsQuerySchema>): Promise<SupportReportDto[]> {
    return this.support.listReports(query.status);
  }

  @Get('reports/:id')
  getReport(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SupportReportDetailDto> {
    return this.support.getReport(user.id, id);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  resolveReport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resolveReportSchema)) body: ResolveReportInput,
  ): Promise<ResolveReportResultDto> {
    return this.support.resolveReport(user.id, id, body);
  }

  @Get('appeals')
  listAppeals(@Query(new ZodPipe(supportAppealsQuerySchema)) query: z.infer<typeof supportAppealsQuerySchema>): Promise<SupportAppealDto[]> {
    return this.support.listAppeals(query.status);
  }

  @Post('appeals/:id/resolve')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  resolveAppeal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resolveAppealSchema)) body: ResolveAppealInput,
  ): Promise<SupportAppealDto> {
    return this.support.resolveAppeal(user.id, id, body);
  }

  @Get('users')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  lookupUser(@CurrentUser() user: AuthUser, @Query(new ZodPipe(supportUserLookupSchema)) query: { tag: string }): Promise<SupportUserDto> {
    return this.support.lookupUser(user.id, query.tag);
  }

  @Post('users/:id/password-reset')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async passwordReset(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ message: string }> {
    await this.support.assistedPasswordReset(user.id, id);
    return { message: 'Enviamos el enlace al correo registrado de la cuenta.' };
  }
}
