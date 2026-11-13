import { Module } from '@nestjs/common';
import { StatusesModule } from '../statuses/statuses.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StatusesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
