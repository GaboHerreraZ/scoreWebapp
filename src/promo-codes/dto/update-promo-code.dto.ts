import {
  IsOptional,
  IsBoolean,
  IsString,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Edición de un código promocional. El code, el scope, el % de descuento, la
 * empresa y el cupo son INMUTABLES (cambiarlos crearía discrepancias con los
 * canjes ya realizados). Solo se permite activar/desactivar, ajustar vigencia
 * y la nota interna.
 */
export class UpdatePromoCodeDto {
  @ApiPropertyOptional({ description: 'Activar/desactivar el código' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Inicio de validez (ISO) o null' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'Fin de validez (ISO) o null' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ description: 'Nota interna' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
