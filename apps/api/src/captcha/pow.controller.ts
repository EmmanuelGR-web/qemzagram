import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { POW_PURPOSES, type PowChallengeDto, type PowPurpose } from '@qemzagram/shared';
import { z } from 'zod';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PowService } from './pow.service';

const querySchema = z.object({ purpose: z.enum(POW_PURPOSES) }).strict();

@Controller('auth/pow')
export class PowController {
  constructor(private readonly pow: PowService) {}

  /** Desafío nuevo para resolver en el navegador. Emitirlo no guarda nada en el servidor. */
  @Public()
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  challenge(@Query(new ZodPipe(querySchema)) query: { purpose: PowPurpose }): PowChallengeDto {
    return this.pow.issue(query.purpose);
  }
}
