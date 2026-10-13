import { Module } from '@nestjs/common';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';
import { CombinedAuthGuard } from './combined-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [AuthModule, AuditModule, ProjectsModule],
  controllers: [TokensController],
  providers: [TokensService, CombinedAuthGuard],
  exports: [TokensService, CombinedAuthGuard],
})
export class TokensModule {}
