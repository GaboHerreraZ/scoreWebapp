import {
  IsBooleanString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Búsqueda en el directorio del facturador.
 *
 * NO hay búsqueda por nombre: el facturador solo filtra por identificación,
 * correo o teléfono, y los tres son "contiene", no exactos. La llave real del
 * tercero es su documento, que es el mismo que va impreso en la factura.
 */
export class FindContactsDto {
  @ApiPropertyOptional({
    description: 'Número de documento (búsqueda por coincidencia parcial)',
    example: '901691260',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  identification?: string;

  @ApiPropertyOptional({ description: 'Correo (coincidencia parcial)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Teléfono (coincidencia parcial)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({
    description:
      'true solo empresas, false solo personas naturales. Omitir busca en ambos.',
  })
  @IsOptional()
  @IsBooleanString()
  isLegalEntity?: string;
}
