import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Publica una versión nueva del plan. No hay edición: cambiar un porcentaje
 * crea otra versión y desactiva la anterior, para no reescribir el histórico.
 */
export class CreateCommissionPlanDto {
  @ApiProperty({ description: 'Nombre de la versión', example: 'Plan 2026' })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    description: '% sobre la primera compra facturada de una empresa referida',
    example: 30,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  newCustomerPercent!: number;

  @ApiProperty({
    description: '% sobre las recompras de esa empresa',
    example: 10,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  recurringPercent!: number;

  @ApiPropertyOptional({ description: 'Nota del cambio (motivo, vigencia…)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
