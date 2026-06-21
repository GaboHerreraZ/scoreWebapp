import { IsOptional, IsString, IsIn, IsBooleanString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterPromoCodeDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filtrar por alcance',
    enum: ['company', 'global'],
  })
  @IsOptional()
  @IsIn(['company', 'global'])
  scope?: 'company' | 'global';

  @ApiPropertyOptional({ description: 'Filtrar por estado activo (true/false)' })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @ApiPropertyOptional({ description: 'Filtrar por empresa (companyId)' })
  @IsOptional()
  @IsString()
  companyId?: string;
}
