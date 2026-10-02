import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResolveIyzicoPaymentReviewDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
