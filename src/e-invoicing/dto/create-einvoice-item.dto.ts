import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Alta de un ítem facturable.
 *
 * El catálogo es NUESTRO: esto crea la fila local y, si hay con qué, empuja la
 * copia al facturador. `taxRefs`, `categoryRef` y `measuringUnitRef` son
 * identificadores del facturador y salen de sus catálogos
 * (GET /admin/einvoices/taxes | /categories | /measuring-units).
 */
export class CreateEInvoiceItemDto {
  @ApiProperty({
    description:
      'Código con el que se factura. Es la llave del producto en el facturador.',
    example: 'PACK-CONSULTAS',
    maxLength: 50,
  })
  @Matches(/^[A-Za-z0-9._-]{1,50}$/, {
    message: 'code solo admite letras, números, punto, guion y guion bajo',
  })
  code: string;

  @ApiProperty({ example: 'Bolsa de análisis de crédito', maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Unidad de medida DIAN. 94 = unidad.',
    default: '94',
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  unitMeasurementCode?: string;

  @ApiPropertyOptional({
    description:
      'Precio de lista, solo referencial: la factura sale con el precio CONGELADO de la venta.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceSell?: number;

  @ApiPropertyOptional({
    description:
      'Tarifa esperada del impuesto (19 = 19%). Se contrasta con la congelada en la venta antes de emitir: si no casan, la factura saldría por otro valor.',
    example: 19,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiPropertyOptional({
    description:
      'Impuestos del facturador que aplican al ítem. Vacío = producto excluido de IVA.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taxRefs?: string[];

  @ApiPropertyOptional({
    description: 'Categoría del facturador. Obligatoria para sincronizar.',
  })
  @IsOptional()
  @IsString()
  categoryRef?: string;

  @ApiPropertyOptional({
    description:
      'Unidad de medida del facturador. Obligatoria para sincronizar. No es el código DIAN.',
  })
  @IsOptional()
  @IsString()
  measuringUnitRef?: string;

  @ApiPropertyOptional({
    description:
      'Si se crea también en el facturador. En false queda solo local y no se puede facturar con él.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  sync?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
