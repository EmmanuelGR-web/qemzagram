import { Logger, Module } from '@nestjs/common';
import { ENV, type AppEnv } from '../config/env';
import { PushController } from './push.controller';
import { PushSender } from './push.port';
import { PushService } from './push.service';
import { DisabledPushSender, WebPushSender } from './web-push.sender';

@Module({
  controllers: [PushController],
  providers: [
    PushService,
    {
      provide: PushSender,
      inject: [ENV],
      useFactory: (env: AppEnv): PushSender => {
        if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
          if (env.NODE_ENV !== 'test') new Logger('NotificationsModule').warn('Sin claves VAPID: las notificaciones push están deshabilitadas.');
          return new DisabledPushSender();
        }
        return new WebPushSender(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
      },
    },
  ],
  exports: [PushService],
})
export class NotificationsModule {}
