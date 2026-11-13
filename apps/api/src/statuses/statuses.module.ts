import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StatusesCleanupService } from './statuses-cleanup.service';
import { StatusesController, StatusMediaController } from './statuses.controller';
import { StatusesService } from './statuses.service';

@Module({
  imports: [MediaModule],
  controllers: [StatusesController, StatusMediaController],
  providers: [StatusesService, StatusesCleanupService],
  exports: [StatusesService, StatusesCleanupService],
})
export class StatusesModule {}
