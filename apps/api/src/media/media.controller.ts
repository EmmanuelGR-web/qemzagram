import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MediaService } from './media.service';
import { sendBuffer } from './send-file';

export const signedQuerySchema = z
  .object({
    exp: z.coerce.number().int().positive(),
    sig: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export type SignedQuery = z.infer<typeof signedQuerySchema>;

/**
 * Descarga de archivos privados. NO es pública: exige sesión (guard global),
 * firma válida y vigente, y permiso sobre el archivo.
 * Límite más alto que el general: un chat con muchas fotos pide varias a la vez.
 */
@Controller('media')
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('a/:id')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(signedQuerySchema)) query: SignedQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.media.getAttachmentForViewer(user.id, id, query.exp, query.sig);
    sendBuffer(request, response, file, query.exp - Date.now() / 1000);
  }

  @Get('s/:id')
  async sticker(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(signedQuerySchema)) query: SignedQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.media.getStickerForOwner(user.id, id, query.exp, query.sig);
    sendBuffer(request, response, file, query.exp - Date.now() / 1000);
  }
}
