import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// Pesos de las 7 dimensiones. La validación de negocio (suman 100, cada uno
// >= MIN_WEIGHT) la hace validateWeights() en el servicio; aquí solo se valida
// el tipo/rango básico de cada campo.
export class CreateScoringConfigurationDto {
  @ApiProperty({ example: 15, description: 'Peso Dim 1: Salud financiera (Z-Altman)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  weightFinancialHealth!: number;

  @ApiProperty({ example: 20, description: 'Peso Dim 2: Capacidad de pago' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  weightPaymentCapacity!: number;

  @ApiProperty({ example: 8, description: 'Peso Dim 3: Coherencia de plazos' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  weightTermCoherence!: number;

  @ApiProperty({ example: 12, description: 'Peso Dim 4: Adecuación del cupo' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  weightCreditLineAdequacy!: number;

  @ApiProperty({ example: 10, description: 'Peso Dim 5: Exposición del capital' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  weightCapitalExposure!: number;

  @ApiProperty({ example: 20, description: 'Peso Dim 6: Veracidad (contraste PDF↔DataCrédito)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  weightVeracity!: number;

  @ApiProperty({ example: 15, description: 'Peso Dim 7: Riesgo de la central' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  weightCentralRisk!: number;
}
