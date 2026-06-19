import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterPaymentAlertDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filtrar por estado de gestión (code)',
    example: 'open',
    enum: ['open', 'in_progress', 'resolved'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de alerta (code)',
    example: 'payment_reversed',
  })
  @IsOptional()
  @IsString()
  type?: string;
}
