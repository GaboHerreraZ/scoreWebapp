import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StatsPeriodDto } from './stats-period.dto.js';

/**
 * Filtro de un ranking: ventana de tiempo + paginación. Default top 5; el front
 * puede pedir más páginas o un limit mayor (acotado).
 */
export class StatsRankingDto extends StatsPeriodDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 5, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 5;
}
