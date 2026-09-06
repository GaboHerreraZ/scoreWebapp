import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsIn,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  PACK_PRODUCT_CODES,
  type PackProductCode,
} from '../../common/constants/pack-products.js';

export class CreateConsultationPriceDto {
  @ApiProperty({ example: 'Precio base 2026', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    example: 25000,
    description: 'Precio FINAL por consulta',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ example: 'COP', default: 'COP', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currencyCode?: string;

  @ApiPropertyOptional({
    example: 19,
    default: 19,
    description:
      'IVA vigente para este precio, en porcentaje (19 = 19%). Se congela en ' +
      'cada compra: si la tarifa cambia, las ventas anteriores conservan la suya.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      'true = unitPrice YA incluye el IVA (se desglosa hacia atrás y el cobro ' +
      'no cambia). false = unitPrice es base gravable y el IVA se SUMA al cobro.',
  })
  @IsOptional()
  @IsBoolean()
  taxIncluded?: boolean;

  @ApiPropertyOptional({
    enum: PACK_PRODUCT_CODES,
    default: 'creditStudy',
    description:
      'Producto que cobra este precio. Cada producto mantiene su propio ' +
      'precio activo. Inmutable después de crear.',
  })
  @IsOptional()
  @IsIn(PACK_PRODUCT_CODES)
  productTypeCode?: PackProductCode;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
