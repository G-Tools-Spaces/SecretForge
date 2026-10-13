import { Module, forwardRef } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  // forwardRef breaks the AuthModule ⇄ AuditModule cycle (AuthService audits
  // auth events; AuditController guards routes with JwtAuthGuard).
  imports: [forwardRef(() => AuthModule)],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
