import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  AddProjectMemberDto,
  UpdateProjectMemberRoleDto,
  UpdateProjectDto,
  AddEnvironmentDto,
} from './dto';
import { ProjectRoleGuard } from './project-role.guard';
import { MinProjectRole, ProjectRole } from './project-role.decorator';
import { ProjectRoleParam } from './project-role-param.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateProjectDto, @Ip() ip: string) {
    return this.projects.create(user.id, dto.orgId, dto, ip);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.projects.listForUser(user.id);
  }

  @Get(':projectId')
  get(@CurrentUser() user: AuthedUser, @Param('projectId') projectId: string) {
    return this.projects.get(projectId, user.id);
  }

  @Patch(':projectId')
  @UseGuards(ProjectRoleGuard)
  @MinProjectRole('ADMIN')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
    @Ip() ip: string,
  ) {
    return this.projects.update(projectId, user.id, dto.name, ip);
  }

  @Delete(':projectId')
  @HttpCode(204)
  @UseGuards(ProjectRoleGuard)
  @MinProjectRole('ADMIN')
  removeProject(@CurrentUser() user: AuthedUser, @Param('projectId') projectId: string, @Ip() ip: string) {
    return this.projects.remove(projectId, user.id, ip);
  }

  @Post(':projectId/envs')
  @UseGuards(ProjectRoleGuard)
  @MinProjectRole('ADMIN')
  addEnvironment(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Body() dto: AddEnvironmentDto,
    @Ip() ip: string,
  ) {
    return this.projects.addEnvironment(projectId, user.id, dto.name, ip);
  }

  @Post(':projectId/members')
  @UseGuards(ProjectRoleGuard)
  @MinProjectRole('ADMIN')
  addMember(
    @CurrentUser() user: AuthedUser,
    @ProjectRoleParam() actorRole: ProjectRole,
    @Param('projectId') projectId: string,
    @Body() dto: AddProjectMemberDto,
    @Ip() ip: string,
  ) {
    return this.projects.addMember(projectId, user.id, actorRole, dto, ip);
  }

  /** Org members who can be added to the project (share-dialog picker). */
  @Get(':projectId/shareable-members')
  @UseGuards(ProjectRoleGuard)
  @MinProjectRole('ADMIN')
  shareableMembers(@CurrentUser() user: AuthedUser, @Param('projectId') projectId: string) {
    return this.projects.shareableOrgMembers(projectId, user.id);
  }

  @Post(':projectId/members/:userId/role')
  @UseGuards(ProjectRoleGuard)
  @MinProjectRole('ADMIN')
  updateMemberRole(
    @CurrentUser() user: AuthedUser,
    @ProjectRoleParam() actorRole: ProjectRole,
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateProjectMemberRoleDto,
    @Ip() ip: string,
  ) {
    return this.projects.updateMemberRole(projectId, user.id, actorRole, targetUserId, dto.role, ip);
  }

  @Delete(':projectId/members/:userId')
  @HttpCode(204)
  @UseGuards(ProjectRoleGuard)
  @MinProjectRole('READ') // members may remove themselves; service re-checks ADMIN for others
  removeMember(
    @CurrentUser() user: AuthedUser,
    @ProjectRoleParam() actorRole: ProjectRole,
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
    @Ip() ip: string,
  ) {
    return this.projects.removeMember(projectId, user.id, actorRole, targetUserId, ip);
  }
}
