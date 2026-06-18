import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreatePackOfferingDto {
  @ApiProperty({ example: 'Pack de 4 consultas', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    example: 'Ideal para empresas que hacen análisis ocasionales',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    example: 4,
    description: 'Número de consultas (análisis de crédito) incluidas',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    example: 365,
    default: 365,
    description: 'Días de vigencia que tendrá la bolsa al comprarse',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  validityDays?: number;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Marca si la oferta tiene descuento por volumen',
  })
  @IsOptional()
  @IsBoolean()
  hasDiscount?: boolean;

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

  @ApiPropertyOptional({
    example: 0,
    default: 0,
    description: 'Orden en que se muestra la oferta en el catálogo',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Si la oferta está vigente en el catálogo ofrecible',
  })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
