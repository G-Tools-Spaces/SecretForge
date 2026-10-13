import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectRoleGuard } from './project-role.guard';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { OrgsModule } from '../orgs/orgs.module';

@Module({
  imports: [AuthModule, AuditModule, OrgsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectRoleGuard],
  exports: [ProjectsService],
})
export class ProjectsModule {}
