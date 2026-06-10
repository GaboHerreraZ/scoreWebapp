import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeTierDto {
  @ApiProperty({
    example: 10,
    description: 'Nuevo cupo mensual de estudios (nivel). Aplica inmediato.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studiesPerMonth: number;
}
