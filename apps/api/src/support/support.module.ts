import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { NearbyModule } from '../nearby/nearby.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupportCleanupService } from './support-cleanup.service';
import { SupportController } from './support.controller';
import { SupportGuard } from './support.guard';
import { SupportService } from './support.service';

@Module({
  imports: [AuthModule, MediaModule, NearbyModule, NotificationsModule],
  controllers: [SupportController],
  providers: [SupportService, SupportGuard, SupportCleanupService],
})
export class SupportModule {}
