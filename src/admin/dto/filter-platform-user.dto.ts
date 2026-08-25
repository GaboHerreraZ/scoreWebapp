import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

/**
 * Filtros del listado de usuarios del sistema (perfiles de las empresas
 * cliente). Los tres campos son independientes y se combinan con AND; `search`
 * (heredado) es la caja única que busca en los tres a la vez.
 */
export class FilterPlatformUserDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Correo (coincidencia parcial)' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Número de identificación (parcial)' })
  @IsOptional()
  @IsString()
  identificationNumber?: string;

  @ApiPropertyOptional({
    description: 'Nombre o apellido (cada palabra debe aparecer en alguno)',
  })
  @IsOptional()
  @IsString()
  name?: string;
}
