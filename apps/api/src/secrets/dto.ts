import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertSecretDto {
  @IsString()
  @MinLength(1, { message: 'Secret value cannot be empty (use DELETE to remove a secret)' })
  @MaxLength(65536, { message: 'Secret value exceeds the 64 KB limit' })
  value!: string;
}

export class BulkImportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000, { message: 'Import content exceeds the 1 MB limit' })
  content!: string;
}
