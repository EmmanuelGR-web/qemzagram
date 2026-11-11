import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  confirmPasswordSchema,
  tagLookupSchema,
  updateProfileSchema,
  type PublicUser,
  type SelfUser,
  type UpdateProfileInput,
} from '@qemzagram/shared';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/auth.constants';
import { requireFile, UsersService } from './users.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
  fileFilter: (_request, file, callback) => {
    if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/.test(file.mimetype)) {
      callback(new BadRequestException({ code: 'INVALID_IMAGE', message: 'Solo se admiten imágenes JPG, PNG o WebP' }), false);
      return;
    }
    callback(null, true);
  },
});

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<SelfUser> {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(updateProfileSchema)) body: UpdateProfileInput): Promise<SelfUser> {
    return this.users.updateProfile(user.id, body);
  }

  @Post('me/avatar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(imageUpload)
  setAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined): Promise<SelfUser> {
    return this.users.setImage(user.id, 'avatar', requireFile(file));
  }

  @Post('me/cover')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(imageUpload)
  setCover(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined): Promise<SelfUser> {
    return this.users.setImage(user.id, 'cover', requireFile(file));
  }

  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: AuthUser): Promise<SelfUser> {
    return this.users.removeImage(user.id, 'avatar');
  }

  @Delete('me/cover')
  removeCover(@CurrentUser() user: AuthUser): Promise<SelfUser> {
    return this.users.removeImage(user.id, 'cover');
  }

  @Post('me/pause')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async pause(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(confirmPasswordSchema)) body: { password: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.users.pauseAccount(user.id, body.password);
    this.clearSessionCookies(response);
  }

  @Post('me/delete')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(confirmPasswordSchema)) body: { password: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.users.deleteAccount(user.id, body.password);
    this.clearSessionCookies(response);
  }

  @Get('by-tag/:tag')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  byTag(@CurrentUser() user: AuthUser, @Param('tag', new ZodPipe(tagLookupSchema)) tag: string): Promise<PublicUser> {
    return this.users.getPublicProfile(user.id, tag);
  }

  private clearSessionCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict' });
    response.clearCookie(REFRESH_COOKIE, { path: '/auth', httpOnly: true, sameSite: 'strict' });
  }
}
