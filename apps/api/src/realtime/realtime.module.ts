import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.port';

@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, { provide: RealtimePublisher, useExisting: RealtimeGateway }],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}
