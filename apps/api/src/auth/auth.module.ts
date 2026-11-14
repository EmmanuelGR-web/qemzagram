import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MfaModule } from '../mfa/mfa.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [JwtModule.register({}), MfaModule],
  controllers: [AuthController],
  providers: [AuthService, TokensService],
  exports: [TokensService, AuthService],
})
export class AuthModule {}
