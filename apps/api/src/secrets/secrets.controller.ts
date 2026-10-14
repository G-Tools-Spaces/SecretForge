import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { ProjectRoleGuard } from '../projects/project-role.guard';
import { MinProjectRole } from '../projects/project-role.decorator';
import { CombinedAuthGuard } from '../tokens/combined-auth.guard';
import { ServiceTokenActor } from '../tokens/tokens.service';
import { SecretActor, SecretsService } from './secrets.service';
import { UpsertSecretDto, BulkImportDto } from './dto';

type AuthedRequest = Request & {
  user?: AuthedUser;
  serviceToken?: ServiceTokenActor;
};

/** Build the audit actor: service token when present, else the JWT user. */
function actorOf(req: AuthedRequest): SecretActor {
  if (req.serviceToken) {
    return { userId: null, actorType: 'TOKEN', tokenName: req.serviceToken.name };
  }
  return { userId: req.user!.id, actorType: 'USER' };
}

/**
 * Secrets routes. All paths carry :projectId so ProjectRoleGuard can enforce
 * membership + minimum role on every request (plan security req #5).
 *
 * CombinedAuthGuard accepts user JWTs OR read-only service tokens (sf_...)
 * scoped to the route's environment (Phase 6).
 *
 * Role matrix:
 *   READ  → list, reveal, export, versions   (service tokens: these only)
 *   WRITE → + upsert, bulk import
 *   ADMIN → + delete, rollback
 */
@Controller('projects/:projectId/envs/:env')
@UseGuards(CombinedAuthGuard, ProjectRoleGuard)
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get('secrets')
  @MinProjectRole('READ')
  list(
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Query('group') group?: string,
  ) {
    return this.secrets.list(projectId, env, group);
  }

  @Put('secrets/:key')
  @MinProjectRole('WRITE')
  upsert(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @Body() dto: UpsertSecretDto,
    @Ip() ip: string,
    @Query('group') group?: string,
  ) {
    return this.secrets.upsert(projectId, env, key, dto.value, user.id, ip, group);
  }

  @Post('secrets/import')
  @MinProjectRole('WRITE')
  bulkImport(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Body() dto: BulkImportDto,
    @Ip() ip: string,
    @Query('group') group?: string,
  ) {
    return this.secrets.bulkImport(projectId, env, dto.content, user.id, ip, group);
  }

  @Get('secrets/export')
  @MinProjectRole('READ')
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // plan req #8: rate limit secret reads
  export(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Ip() ip: string,
    @Query('group') group?: string,
  ) {
    return this.secrets.export(projectId, env, actorOf(req), ip, group);
  }

  @Get('secrets/:key')
  @MinProjectRole('READ')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  reveal(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @Ip() ip: string,
    @Query('group') group?: string,
  ) {
    return this.secrets.reveal(projectId, env, key, actorOf(req), ip, group);
  }

  @Get('secrets/:key/versions')
  @MinProjectRole('READ')
  versions(
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @Query('group') group?: string,
  ) {
    return this.secrets.versions(projectId, env, key, group);
  }

  @Post('secrets/:key/versions/:version/rollback')
  @HttpCode(200)
  @MinProjectRole('ADMIN')
  rollback(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @Param('version') version: string,
    @Ip() ip: string,
    @Query('group') group?: string,
  ) {
    const v = parseInt(version, 10);
    if (Number.isNaN(v) || v < 1) {
      throw new BadRequestException('Invalid version number');
    }
    return this.secrets.rollback(projectId, env, key, v, user.id, ip, group);
  }

  @Delete('secrets/:key')
  @HttpCode(204)
  @MinProjectRole('ADMIN')
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @Ip() ip: string,
    @Query('group') group?: string,
  ) {
    return this.secrets.remove(projectId, env, key, user.id, ip, group);
  }
}
