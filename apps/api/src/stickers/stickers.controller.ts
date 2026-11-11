import { BadRequestException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { STICKER_UPLOAD_MAX_BYTES, type StickerDto } from '@qemzagram/shared';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { StickersService } from './stickers.service';

const stickerUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: STICKER_UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 1 },
});

@Controller('stickers')
export class StickersController {
  constructor(private readonly stickers: StickersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<StickerDto[]> {
    return this.stickers.list(user.id);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(stickerUpload)
  create(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined): Promise<StickerDto> {
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Elegí una imagen' });
    return this.stickers.create(user.id, file.buffer);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.stickers.remove(user.id, id);
  }
}
