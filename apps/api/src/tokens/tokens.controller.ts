import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { ProjectRoleGuard } from '../projects/project-role.guard';
import { MinProjectRole } from '../projects/project-role.decorator';
import { TokensService } from './tokens.service';
import { CreateTokenDto } from './dto';

/**
 * Service-token management (Phase 6). User-JWT only — service tokens
 * themselves cannot manage tokens (CombinedAuthGuard is for secret reads).
 *
 * Role matrix:
 *   READ  → list token metadata
 *   ADMIN → create, revoke
 */
@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, ProjectRoleGuard)
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Post('envs/:env/tokens')
  @MinProjectRole('ADMIN')
  create(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Body() dto: CreateTokenDto,
    @Ip() ip: string,
  ) {
    return this.tokens.create(projectId, env, dto.name, dto.expiresInDays, user.id, ip);
  }

  @Get('tokens')
  @MinProjectRole('READ')
  list(@Param('projectId') projectId: string) {
    return this.tokens.list(projectId);
  }

  @Delete('tokens/:tokenId')
  @HttpCode(204)
  @MinProjectRole('ADMIN')
  revoke(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('tokenId') tokenId: string,
    @Ip() ip: string,
  ) {
    return this.tokens.revoke(projectId, tokenId, user.id, ip);
  }
}
