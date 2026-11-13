import { Module } from '@nestjs/common';
import { StatusesCleanupService } from './statuses-cleanup.service';
import { StatusesController } from './statuses.controller';
import { StatusesService } from './statuses.service';

@Module({
  controllers: [StatusesController],
  providers: [StatusesService, StatusesCleanupService],
  exports: [StatusesService, StatusesCleanupService],
})
export class StatusesModule {}
