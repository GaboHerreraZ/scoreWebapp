import {
  IsOptional,
  IsNumber,
  IsArray,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SimulatePricingDto {
  @ApiProperty({
    example: 40000,
    description: 'Precio de venta por consulta a precio lleno (COP)',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({
    example: 12000,
    description: 'Costo variable por consulta en pesos (COP)',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  variableCost: number;

  @ApiProperty({
    example: 16000,
    description:
      'Margen mínimo en pesos que se quiere conservar por consulta (piso de negocio). Define el descuento máximo que se puede ofrecer.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minMarginAmount: number;

  @ApiProperty({
    example: 15000000,
    description: 'Costos fijos mensuales / punto de equilibrio a cubrir (COP)',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedCosts: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 101, 301, 501, 1001, 2001],
    description:
      'Cantidades mínimas (consultas/mes) donde arranca cada tramo. Si se omite, se usan cortes por defecto: [1, 101, 301, 501, 1001, 2001].',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  volumeBreakpoints?: number[];
}
