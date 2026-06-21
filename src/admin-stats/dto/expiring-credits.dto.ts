import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StatsRankingDto } from './stats-ranking.dto.js';

export class ExpiringCreditsDto extends StatsRankingDto {
  @ApiPropertyOptional({
    description: 'Ventana hacia el futuro en días (default 30)',
    default: 30,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;
}
