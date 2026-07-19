import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Ventana de tiempo de una métrica. Si no se envían fechas, el service usa el
 * MES ACTUAL por defecto. El rango se acota (máx 1 año) en el service para
 * evitar consultas sobre rangos enormes.
 */
export class StatsPeriodDto {
  @ApiPropertyOptional({
    description:
      'Inicio del periodo (ISO). Default: primer día del mes actual.',
    example: '2026-06-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Fin del periodo (ISO). Default: ahora.',
    example: '2026-06-30T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
