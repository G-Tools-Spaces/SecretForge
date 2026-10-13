import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { EnvService } from '../config/env.service';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { OAuthController } from './oauth.controller';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // forwardRef breaks the AuthModule ⇄ AuditModule cycle.
    forwardRef(() => AuditModule),
    JwtModule.registerAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        secret: env.jwtSecret,
        signOptions: { expiresIn: env.accessTokenTtl },
      }),
    }),
  ],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, OAuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
