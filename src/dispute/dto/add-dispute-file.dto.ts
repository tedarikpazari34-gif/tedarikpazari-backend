import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class AddDisputeFileDto {
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(2048)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ])
  fileType?: string;
}
