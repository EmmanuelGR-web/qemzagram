import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StickersModule } from '../stickers/stickers.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({ imports: [MediaModule, StickersModule], controllers: [ChatsController], providers: [ChatsService], exports: [ChatsService] })
export class ChatsModule {}
