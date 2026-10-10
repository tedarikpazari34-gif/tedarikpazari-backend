import { IsString, Length } from 'class-validator';

export class RejectProductRevisionDto {
  @IsString()
  @Length(1, 1000)
  reason!: string;
}
