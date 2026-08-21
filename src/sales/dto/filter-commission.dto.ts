import { IsOptional, IsUUID, IsIn, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export class FilterCommissionDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Vendedor. Se ignora si quien consulta ES un vendedor: siempre ve lo suyo.',
  })
  @IsOptional()
  @IsUUID()
  salesRepId?: string;

  @ApiPropertyOptional({ description: 'Empresa referida' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({
    description: 'Estado de la comisión',
    enum: ['pending', 'paid', 'cancelled'],
  })
  @IsOptional()
  @IsIn(['pending', 'paid', 'cancelled'])
  status?: 'pending' | 'paid' | 'cancelled';

  @ApiPropertyOptional({
    description: 'Tipo de venta',
    enum: ['new', 'recurring'],
  })
  @IsOptional()
  @IsIn(['new', 'recurring'])
  kind?: 'new' | 'recurring';

  @ApiPropertyOptional({
    description: "Mes desde, 'YYYY-MM'",
    example: '2026-01',
  })
  @IsOptional()
  @Matches(MONTH_FORMAT, { message: "fromMonth debe tener formato 'YYYY-MM'" })
  fromMonth?: string;

  @ApiPropertyOptional({
    description: "Mes hasta, 'YYYY-MM'",
    example: '2026-12',
  })
  @IsOptional()
  @Matches(MONTH_FORMAT, { message: "toMonth debe tener formato 'YYYY-MM'" })
  toMonth?: string;
}

/** Filtros del consolidado mes a mes (sin paginación: son pocas filas). */
export class FilterCommissionSummaryDto {
  @ApiPropertyOptional({ description: 'Vendedor (solo para rol admin)' })
  @IsOptional()
  @IsUUID()
  salesRepId?: string;

  @ApiPropertyOptional({ description: "Mes desde, 'YYYY-MM'" })
  @IsOptional()
  @Matches(MONTH_FORMAT, { message: "fromMonth debe tener formato 'YYYY-MM'" })
  fromMonth?: string;

  @ApiPropertyOptional({ description: "Mes hasta, 'YYYY-MM'" })
  @IsOptional()
  @Matches(MONTH_FORMAT, { message: "toMonth debe tener formato 'YYYY-MM'" })
  toMonth?: string;
}
