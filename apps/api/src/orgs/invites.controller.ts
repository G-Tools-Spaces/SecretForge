import { Body, Controller, Get, HttpCode, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { OrgsService } from './orgs.service';
import { AcceptInviteDto } from './dto';

/**
 * Token-based invite endpoints backing the web /invite/<token> page.
 * The preview is intentionally public (the link is a bearer token) but only
 * leaks the org name, role and a masked email. Accepting requires auth.
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly orgs: OrgsService) {}

  @Get(':token')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  preview(@Param('token') token: string) {
    return this.orgs.getInviteByToken(token);
  }

  @Post('accept')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  accept(@CurrentUser() user: AuthedUser, @Body() dto: AcceptInviteDto, @Ip() ip: string) {
    return this.orgs.acceptInvite(user.id, user.email, dto.token, ip);
  }
}
