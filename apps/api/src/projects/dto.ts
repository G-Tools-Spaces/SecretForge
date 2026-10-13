import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
  @IsString()
  userId!: string;

  @IsIn(['ADMIN', 'WRITE', 'READ'])
  role!: 'ADMIN' | 'WRITE' | 'READ';
}

export class UpdateProjectMemberRoleDto {
  @IsIn(['ADMIN', 'WRITE', 'READ'])
  role!: 'ADMIN' | 'WRITE' | 'READ';
}
