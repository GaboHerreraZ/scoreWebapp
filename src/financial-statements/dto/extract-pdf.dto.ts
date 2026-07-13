import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Datos que el usuario aporta al subir el PDF de estados financieros a un
 * estudio YA existente. Las cifras las extrae la IA del PDF; aquí solo va el
 * contexto que la IA no puede inferir con certeza.
 *
 * Llega como multipart/form-data junto al archivo, por lo que los numéricos se
 * transforman desde string con @Type.
 */
export class ExtractPdfDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'ID del Parameter income_statement (período del estado de resultados: mensual/anual). Rige la anualización de la capacidad de pago.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  incomeStatementId?: number;

  @ApiPropertyOptional({
    example: 2024,
    description:
      'Año fiscal del período corriente. Se usa solo si el PDF no trae fecha de balance de la cual inferirlo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear?: number;
}
