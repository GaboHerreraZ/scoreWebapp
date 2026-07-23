import {
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsEnum,
  ArrayMinSize,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Técnica para generar la curva de precio unitario decreciente:
 * - exponential: decae rápido al inicio y se aplana hacia el piso (asintótico).
 * - power: curva de experiencia (ley de potencia), descuento parejo en escala log.
 * - linear: baja proporcional a la cantidad hasta el piso.
 */
export enum PricingTechnique {
  EXPONENTIAL = 'exponential',
  POWER = 'power',
  LINEAR = 'linear',
}

export class SimulatePricingDto {
  @ApiPropertyOptional({
    enum: PricingTechnique,
    default: PricingTechnique.EXPONENTIAL,
    description:
      'Fórmula de la curva de descuento: exponential (recomendada, piso asintótico), power (curva de experiencia BCG) o linear',
  })
  @IsOptional()
  @IsEnum(PricingTechnique)
  technique?: PricingTechnique;

  @ApiProperty({
    example: 25000,
    description:
      'Precio unitario mínimo (piso) al que puede llegar la consulta en la bolsa más grande (COP). Debe ser menor al precio activo.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  floorPrice: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 5, 10, 25, 50, 100, 200],
    description:
      'Tamaños de bolsa (número de consultas) a cotizar. Default: [1, 5, 10, 25, 50, 100, 200]. La curva se calibra para tocar el piso en el tamaño mayor.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  packSizes?: number[];

  @ApiPropertyOptional({
    example: 15000,
    description:
      'Costo variable por consulta (COP). Si se envía, se calculan márgenes y se valida que el precio marginal entre bolsas no caiga por debajo del costo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  variableCost?: number;

  @ApiPropertyOptional({
    example: 15000000,
    description:
      'Costos fijos mensuales (COP). Si se envía, se calcula el punto de equilibrio por bolsa.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedCosts?: number;

  @ApiPropertyOptional({
    example: 10,
    description:
      'Cantidad de consultas a partir de la cual empieza el descuento. Las bolsas con esta cantidad o menos se cotizan a precio lleno (P₀, 0% de descuento) y la curva se recalibra para arrancar aquí y tocar el piso en la bolsa más grande. Default: la bolsa más pequeña (la primera bolsa nunca tiene descuento).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  discountStartQuantity?: number;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description:
      'Solo para technique=exponential: acelera (>1) o suaviza (<1) el descuento en las bolsas pequeñas. Con 2, el descuento inicial crece ~2x y la curva llega al piso desde la mitad del rango. Rango: 0.1 a 10.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  curveStrength?: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'Redondeo psicológico: totales terminados en 999 (ej. $379.999). Nunca perfora el piso ni genera ahorro negativo.',
  })
  @IsOptional()
  @IsBoolean()
  charmRounding?: boolean;
}
