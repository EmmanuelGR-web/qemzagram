import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  createMediaStatusSchema,
  createTextStatusSchema,
  updateStatusPrivacySchema,
  STATUS_TEXT_MAX_LENGTH,
  UPLOAD_MAX_BYTES,
  type CreateMediaStatusInput,
  type CreateTextStatusInput,
  type StatusDto,
  type StatusOverviewDto,
  type StatusPrivacyDto,
  type UpdateStatusPrivacyInput,
} from '@qemzagram/shared';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { signedQuerySchema, type SignedQuery } from '../media/media.controller';
import { sendBuffer } from '../media/send-file';
import { StatusesService } from './statuses.service';

/** Un solo archivo + los campos "kind" y "caption". El tipo real lo valida MediaProcessor por contenido. */
const statusUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: {
    fileSize: Math.max(UPLOAD_MAX_BYTES.image, UPLOAD_MAX_BYTES.video),
    files: 1,
    fields: 2,
    parts: 3,
    fieldSize: STATUS_TEXT_MAX_LENGTH * 4,
  },
});

@Controller('statuses')
export class StatusesController {
  constructor(private readonly statuses: StatusesService) {}

  /** Tus estados vigentes + los de tu agenda que podés ver. */
  @Get()
  overview(@CurrentUser() user: AuthUser): Promise<StatusOverviewDto> {
    return this.statuses.overview(user.id);
  }

  /** Quién puede ver mis estados. */
  @Get('privacy')
  getPrivacy(@CurrentUser() user: AuthUser): Promise<StatusPrivacyDto> {
    return this.statuses.getPrivacy(user.id);
  }

  @Put('privacy')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  updatePrivacy(@CurrentUser() user: AuthUser, @Body(new ZodPipe(updateStatusPrivacySchema)) body: UpdateStatusPrivacyInput): Promise<StatusPrivacyDto> {
    return this.statuses.updatePrivacy(user.id, body);
  }

  @Post('text')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createText(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createTextStatusSchema)) body: CreateTextStatusInput): Promise<StatusDto> {
    return this.statuses.createText(user.id, body);
  }

  @Post('media')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(statusUpload)
  createMedia(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createMediaStatusSchema)) body: CreateMediaStatusInput,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StatusDto> {
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Elegí una foto o un video' });
    return this.statuses.createMedia(user.id, body, { buffer: file.buffer, originalName: 'estado' });
  }
}

/**
 * Foto o video de un estado: exige sesión (guard global), URL firmada vigente
 * y permiso actual para ver el estado. Vive bajo /media como el resto de los archivos privados.
 */
@Controller('media')
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class StatusMediaController {
  constructor(private readonly statuses: StatusesService) {}

  @Get('e/:id')
  async statusMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(signedQuerySchema)) query: SignedQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.statuses.getMediaForViewer(user.id, id, query.exp, query.sig);
    sendBuffer(request, response, file, query.exp - Date.now() / 1000);
  }
}
