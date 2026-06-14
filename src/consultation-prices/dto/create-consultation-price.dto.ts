import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateConsultationPriceDto {
  @ApiProperty({ example: 'Precio base 2026', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    example: 25000,
    description:
      'Precio FINAL por consulta (ya con descuento aplicado, si aplica)',
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
    example: false,
    description: 'Marca si este precio es promocional',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  hasDiscount?: boolean;

  @ApiPropertyOptional({
    example: 25000,
    description: 'Precio normal antes del descuento (informativo)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional({
    example: 1,
    description: "Parameter ID (type 'discount_type'): 'percentage' | 'fixed'",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  discountTypeId?: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Valor del descuento: 10 (=10%) o 5000 (=$5.000 menos)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiProperty({
    example: '2026-01-01',
    description: 'Fecha desde la que rige este precio (YYYY-MM-DD)',
  })
  @IsDateString()
  validFrom: string;

  @ApiPropertyOptional({
    example: '2026-03-01',
    description: 'Fecha hasta la que rige (promo temporal). Null = indefinido',
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
