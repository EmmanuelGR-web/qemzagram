import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { MediaModule } from '../media/media.module';
import { StickersModule } from '../stickers/stickers.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({ imports: [MediaModule, StickersModule, BlocksModule], controllers: [ChatsController], providers: [ChatsService], exports: [ChatsService] })
export class ChatsModule {}
