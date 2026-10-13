import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  orgId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsIn(['ADMIN', 'WRITE', 'READ'])
  creatorRole?: 'ADMIN' | 'WRITE' | 'READ'; // defaults to ADMIN
}

export class AddProjectMemberDto {
  /** Either userId or email (sharing by email is the friendly path). */
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsIn(['ADMIN', 'WRITE', 'READ'])
  role!: 'ADMIN' | 'WRITE' | 'READ';
}

export class UpdateProjectMemberRoleDto {
  @IsIn(['ADMIN', 'WRITE', 'READ'])
  role!: 'ADMIN' | 'WRITE' | 'READ';
}

export class UpdateProjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class AddEnvironmentDto {
  /** e.g. "qa", "preview" — validated against env-name rules in the service. */
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;
}
