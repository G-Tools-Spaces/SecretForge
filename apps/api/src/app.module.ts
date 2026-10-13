import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { OrgsModule } from './orgs/orgs.module';
import { ProjectsModule } from './projects/projects.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    // Global rate limiting. Login and secret-read endpoints get stricter
    // per-route limits in their controllers (plan security req #8).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ConfigModule,
    PrismaModule,
    CryptoModule,
    AuthModule,
    OrgsModule,
    ProjectsModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
