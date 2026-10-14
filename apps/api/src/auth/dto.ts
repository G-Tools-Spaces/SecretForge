import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /** Present when the user has 2FA enabled (second login step). */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  totpCode?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class UpdateProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class OAuthExchangeDto {
  @IsString()
  @MinLength(1)
  code!: string;
}

export class TotpCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(10)
  code!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(256)
  newPassword!: string;

  /** Caller’s current session — kept alive while all others are revoked. */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
