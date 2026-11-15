import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { E2eeModule } from '../e2ee/e2ee.module';
import { NearbyModule } from '../nearby/nearby.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StatusesModule } from '../statuses/statuses.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StatusesModule, NotificationsModule, BlocksModule, NearbyModule, E2eeModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
