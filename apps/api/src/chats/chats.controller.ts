import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  addGroupMemberSchema,
  createDirectChatSchema,
  createGroupSchema,
  listMessagesQuerySchema,
  MESSAGE_MAX_LENGTH,
  sendAttachmentSchema,
  sendMessageSchema,
  UPLOAD_MAX_BYTES_ANY,
  type ConversationDto,
  type CreateGroupInput,
  type MessageDto,
  type SendAttachmentInput,
} from '@qemzagram/shared';
import { memoryStorage } from 'multer';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChatsService } from './chats.service';

/**
 * Subida de adjuntos: un solo archivo + los campos "kind" y "caption".
 * El tipo real se valida después por CONTENIDO (MediaProcessor); acá solo se limitan tamaños y cantidades.
 */
const attachmentUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES_ANY, files: 1, fields: 2, parts: 3, fieldSize: MESSAGE_MAX_LENGTH * 4 },
});

/** Multer interpreta el nombre del archivo como latin1: se recupera el UTF-8 original (tildes, ñ). */
function uploadedFile(file: Express.Multer.File | undefined): { buffer: Buffer; originalName: string } {
  if (!file?.buffer?.length) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Adjuntá un archivo' });
  return { buffer: file.buffer, originalName: Buffer.from(file.originalname ?? '', 'latin1').toString('utf8') };
}

@Controller('chats')
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConversationDto[]> {
    return this.chats.list(user.id);
  }

  @Post('direct')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  openDirect(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createDirectChatSchema)) body: { tag: string }): Promise<ConversationDto> {
    return this.chats.openDirect(user.id, body.tag);
  }

  @Post('groups')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createGroup(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createGroupSchema)) body: CreateGroupInput): Promise<ConversationDto> {
    return this.chats.createGroup(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ConversationDto> {
    return this.chats.get(user.id, id);
  }

  @Post(':id/members')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addGroupMemberSchema)) body: { tag: string },
  ): Promise<ConversationDto> {
    return this.chats.addMember(user.id, id, body.tag);
  }

  @Delete(':id/members/me')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.chats.leave(user.id, id);
  }

  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(listMessagesQuerySchema)) query: z.infer<typeof listMessagesQuerySchema>,
  ): Promise<MessageDto[]> {
    return this.chats.listMessages(user.id, id, query.limit, query.before);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 10_000 } })
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sendMessageSchema)) body: { body: string },
  ): Promise<MessageDto> {
    return this.chats.sendMessage(user.id, id, body.body);
  }

  @Post(':id/attachments')
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(attachmentUpload)
  sendAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sendAttachmentSchema)) body: SendAttachmentInput,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<MessageDto> {
    return this.chats.sendAttachment(user.id, id, body, uploadedFile(file));
  }
}
