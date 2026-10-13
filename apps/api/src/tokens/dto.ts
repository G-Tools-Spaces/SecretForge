import { IsInt, IsNotEmpty, IsString, Length, Max, Min } from 'class-validator';

export class CreateTokenDto {
  /** Human label, e.g. "GitHub Actions — prod deploy". */
  @IsString()
  @IsNotEmpty()
  @Length(1, 60)
  name!: string;

  /** Days until the token expires (plan req #7: expiring). Default 30, max 365. */
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays!: number;
}
