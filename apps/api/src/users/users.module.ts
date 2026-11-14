import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { NearbyModule } from '../nearby/nearby.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StatusesModule } from '../statuses/statuses.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StatusesModule, NotificationsModule, BlocksModule, NearbyModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
