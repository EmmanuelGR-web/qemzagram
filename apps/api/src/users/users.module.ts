import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StatusesModule } from '../statuses/statuses.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StatusesModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
