import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({ imports: [MediaModule], controllers: [ChatsController], providers: [ChatsService] })
export class ChatsModule {}
