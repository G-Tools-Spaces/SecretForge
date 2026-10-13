import { Module } from '@nestjs/common';
import { OrgsController } from './orgs.controller';
import { InvitesController } from './invites.controller';
import { OrgsService } from './orgs.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [OrgsController, InvitesController],
  providers: [OrgsService],
  exports: [OrgsService],
})
export class OrgsModule {}
