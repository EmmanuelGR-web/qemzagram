import { Module } from '@nestjs/common';
import { ENV, type AppEnv } from '../config/env';
import { AntivirusPort } from './antivirus.port';
import { ClamAvScanner } from './clamav.scanner';
import { DisabledAntivirus } from './disabled-antivirus';
import { FfmpegTranscoder } from './ffmpeg.transcoder';
import { MediaTranscoder } from './transcoder.port';
import { MediaController } from './media.controller';
import { MediaProcessor } from './media-processor.service';
import { MediaUrlService } from './media-url.service';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaUrlService,
    MediaProcessor,
    {
      provide: MediaTranscoder,
      inject: [ENV],
      useFactory: (env: AppEnv): MediaTranscoder => new FfmpegTranscoder(env.FFMPEG_PATH, env.FFPROBE_PATH),
    },
    {
      provide: AntivirusPort,
      inject: [ENV],
      useFactory: (env: AppEnv): AntivirusPort =>
        env.CLAMAV_HOST ? new ClamAvScanner(env.CLAMAV_HOST, env.CLAMAV_PORT) : new DisabledAntivirus(),
    },
  ],
  exports: [MediaService, MediaUrlService, MediaProcessor],
})
export class MediaModule {}
