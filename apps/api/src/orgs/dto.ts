import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class UpdateOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class InviteMemberDto {
  @IsString()
  email!: string;

  @IsOptional()
  @IsIn(['ADMIN', 'MEMBER'])
  role?: 'ADMIN' | 'MEMBER';
}

export class UpdateMemberRoleDto {
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  role!: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export class AcceptInviteDto {
  @IsString()
  token!: string;
}

export class RemoveMemberDto {
  @IsString()
  userId!: string;
}
