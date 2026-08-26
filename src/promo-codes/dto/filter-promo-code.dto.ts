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

  @ApiPropertyOptional({
    description: 'Filtrar por estado activo (true/false)',
  })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @ApiPropertyOptional({ description: 'Filtrar por empresa (companyId)' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de compra al que aplica',
    enum: ['any', 'first_purchase'],
  })
  @IsOptional()
  @IsIn(['any', 'first_purchase'])
  appliesTo?: 'any' | 'first_purchase';

  @ApiPropertyOptional({
    description:
      'Filtrar por financiador: "creditia" (sin vendedor) o el id de un ' +
      'vendedor. Solo lo usa un admin: un vendedor siempre ve los suyos.',
  })
  @IsOptional()
  @IsString()
  fundedBy?: string;

  @ApiPropertyOptional({
    description:
      'Solo los códigos propios: los que creé yo o los que financia mi ' +
      'comisión. Lo usa la pantalla "Mis códigos", donde un admin no debe ' +
      'ver los de los demás.',
  })
  @IsOptional()
  @IsBooleanString()
  mine?: string;
}
