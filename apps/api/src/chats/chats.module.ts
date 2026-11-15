import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { E2eeModule } from '../e2ee/e2ee.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StickersModule } from '../stickers/stickers.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({ imports: [MediaModule, StickersModule, BlocksModule, NotificationsModule, E2eeModule], controllers: [ChatsController], providers: [ChatsService], exports: [ChatsService] })
export class ChatsModule {}
