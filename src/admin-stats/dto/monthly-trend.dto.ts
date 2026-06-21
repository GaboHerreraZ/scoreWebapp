import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MonthlyTrendDto {
  @ApiPropertyOptional({
    description: 'Cantidad de meses hacia atrás (default 6, máx 24)',
    default: 6,
    maximum: 24,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number = 6;
}
