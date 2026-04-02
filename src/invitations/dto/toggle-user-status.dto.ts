import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleUserStatusDto {
  @ApiProperty({ example: false, description: 'true para activar, false para desactivar' })
  @IsBoolean()
  isActive: boolean;
}
