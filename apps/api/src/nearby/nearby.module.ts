import { Module } from '@nestjs/common';
import { NearbyCleanupService } from './nearby-cleanup.service';
import { NearbyController } from './nearby.controller';
import { NearbyService } from './nearby.service';

@Module({ controllers: [NearbyController], providers: [NearbyService, NearbyCleanupService], exports: [NearbyService] })
export class NearbyModule {}
