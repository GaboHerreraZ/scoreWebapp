import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateFeatureFlagDto {
  @ApiProperty({ description: 'Estado del flag' })
  @IsBoolean()
  enabled!: boolean;
}
