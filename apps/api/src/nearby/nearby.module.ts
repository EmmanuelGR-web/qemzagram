import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { GreetingsService } from './greetings.service';
import { NearbyCleanupService } from './nearby-cleanup.service';
import { NearbyController } from './nearby.controller';
import { NearbyService } from './nearby.service';

@Module({
  imports: [BlocksModule],
  controllers: [NearbyController],
  providers: [NearbyService, GreetingsService, NearbyCleanupService],
  exports: [NearbyService, GreetingsService],
})
export class NearbyModule {}
