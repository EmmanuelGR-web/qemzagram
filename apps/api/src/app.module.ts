import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BlocksModule } from './blocks/blocks.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CallsModule } from './calls/calls.module';
import { ChatsModule } from './chats/chats.module';
import { CommonModule } from './common/common.module';
import { OriginGuard } from './common/origin.guard';
import { ConfigModule } from './config/config.module';
import { ENV, type AppEnv } from './config/env';
import { ContactsModule } from './contacts/contacts.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StatusesModule } from './statuses/statuses.module';
import { StickersModule } from './stickers/stickers.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
    MailModule,
    StorageModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: AppEnv) => ({
        // Límite general por IP; cada ruta sensible define uno más estricto con @Throttle.
        throttlers: [{ ttl: 60_000, limit: 120 }],
        skipIf: () => env.NODE_ENV === 'test',
      }),
    }),
    AuthModule,
    UsersModule,
    ContactsModule,
    BlocksModule,
    MediaModule,
    StickersModule,
    ChatsModule,
    StatusesModule,
    CallsModule,
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [
    // Orden de ejecución: límite de peticiones → verificación de origen (anti-CSRF) → sesión.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
