import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { OrgsService } from './orgs.service';
import { CreateOrgDto, InviteMemberDto, UpdateMemberRoleDto, AcceptInviteDto, UpdateOrgDto } from './dto';

@Controller('orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateOrgDto, @Ip() ip: string) {
    return this.orgs.create(user.id, dto, ip);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.orgs.listForUser(user.id);
  }

  @Get(':orgId')
  get(@CurrentUser() user: AuthedUser, @Param('orgId') orgId: string) {
    return this.orgs.get(orgId, user.id);
  }

  @Patch(':orgId')
  update(@CurrentUser() user: AuthedUser, @Param('orgId') orgId: string, @Body() dto: UpdateOrgDto, @Ip() ip: string) {
    return this.orgs.update(orgId, user.id, dto, ip);
  }

  @Post(':orgId/invite')
  invite(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Body() dto: InviteMemberDto,
    @Ip() ip: string,
  ) {
    return this.orgs.invite(orgId, user.id, dto, ip);
  }

  @Post(':orgId/invites/accept')
  @HttpCode(200)
  acceptInvite(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Body() dto: AcceptInviteDto,
    @Ip() ip: string,
  ) {
    return this.orgs.acceptInvite(user.id, user.email, dto.token, ip);
  }

  @Get(':orgId/invites')
  listInvites(@CurrentUser() user: AuthedUser, @Param('orgId') orgId: string) {
    return this.orgs.listInvites(orgId, user.id);
  }

  @Delete(':orgId/invites/:inviteId')
  @HttpCode(204)
  revokeInvite(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('inviteId') inviteId: string,
    @Ip() ip: string,
  ) {
    return this.orgs.revokeInvite(orgId, user.id, inviteId, ip);
  }

  @Post(':orgId/members/:userId/role')
  updateMemberRole(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Ip() ip: string,
  ) {
    return this.orgs.updateMemberRole(orgId, user.id, targetUserId, dto.role, ip);
  }

  @Delete(':orgId/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Ip() ip: string,
  ) {
    return this.orgs.removeMember(orgId, user.id, targetUserId, ip);
  }
}
