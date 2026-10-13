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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { ProjectRoleGuard } from '../projects/project-role.guard';
import { MinProjectRole } from '../projects/project-role.decorator';
import { SecretsService } from './secrets.service';
import { UpsertSecretDto, BulkImportDto } from './dto';

/**
 * Secrets routes. All paths carry :projectId so ProjectRoleGuard can enforce
 * membership + minimum role on every request (plan security req #5).
 *
 * Role matrix:
 *   READ  → list, reveal, export, versions
 *   WRITE → + upsert, bulk import
 *   ADMIN → + delete, rollback
 */
@Controller('projects/:projectId/envs/:env')
@UseGuards(JwtAuthGuard, ProjectRoleGuard)
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get('secrets')
  @MinProjectRole('READ')
  list(@Param('projectId') projectId: string, @Param('env') env: string) {
    return this.secrets.list(projectId, env);
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
  ) {
    return this.secrets.upsert(projectId, env, key, dto.value, user.id, ip);
  }

  @Post('secrets/import')
  @MinProjectRole('WRITE')
  bulkImport(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Body() dto: BulkImportDto,
    @Ip() ip: string,
  ) {
    return this.secrets.bulkImport(projectId, env, dto.content, user.id, ip);
  }

  @Get('secrets/export')
  @MinProjectRole('READ')
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // plan req #8: rate limit secret reads
  export(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Ip() ip: string,
  ) {
    return this.secrets.export(projectId, env, user.id, ip);
  }

  @Get('secrets/:key')
  @MinProjectRole('READ')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  reveal(
    @CurrentUser() user: AuthedUser,
    @Param('projectId') projectId: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @Ip() ip: string,
  ) {
    return this.secrets.reveal(projectId, env, key, user.id, ip);
  }

  @Get('secrets/:key/versions')
  @MinProjectRole('READ')
  versions(@Param('projectId') projectId: string, @Param('env') env: string, @Param('key') key: string) {
    return this.secrets.versions(projectId, env, key);
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
  ) {
    const v = parseInt(version, 10);
    if (Number.isNaN(v) || v < 1) {
      throw new BadRequestException('Invalid version number');
    }
    return this.secrets.rollback(projectId, env, key, v, user.id, ip);
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
  ) {
    return this.secrets.remove(projectId, env, key, user.id, ip);
  }
}
