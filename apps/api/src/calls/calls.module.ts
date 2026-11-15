import { Logger, Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { ChatsModule } from '../chats/chats.module';
import { E2eeModule } from '../e2ee/e2ee.module';
import { ENV, type AppEnv } from '../config/env';
import { NotificationsModule } from '../notifications/notifications.module';
import { CallMediaPort } from './call-media.port';
import { CallsTimeoutService } from './calls-timeout.service';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { DisabledCallMedia, LiveKitCallMedia } from './livekit.media';

@Module({
  imports: [ChatsModule, NotificationsModule, BlocksModule, E2eeModule],
  controllers: [CallsController],
  providers: [
    CallsService,
    CallsTimeoutService,
    {
      provide: CallMediaPort,
      inject: [ENV],
      useFactory: (env: AppEnv): CallMediaPort => {
        if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
          new Logger('CallsModule').warn('LiveKit no está configurado: las llamadas quedan deshabilitadas.');
          return new DisabledCallMedia();
        }
        const apiUrl = env.LIVEKIT_API_URL ?? env.LIVEKIT_URL.replace(/^ws/, 'http');
        return new LiveKitCallMedia(env.LIVEKIT_URL, apiUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
      },
    },
  ],
  exports: [CallsService],
})
export class CallsModule {}
