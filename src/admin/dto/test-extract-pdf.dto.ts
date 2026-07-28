import { IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

/**
 * Contexto de la prueba de extracción del portal admin. Es el mismo que aporta
 * el usuario en el flujo real (ExtractPdfDto) más la opción de ver el texto
 * crudo del modelo, útil al afinar el prompt.
 *
 * Llega como multipart/form-data junto al archivo, por lo que los numéricos se
 * transforman desde string con @Type.
 */
export class TestExtractPdfDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'ID del Parameter income_statement (período del estado de resultados: mensual/anual). Rige la anualización de la capacidad de pago. Si no se envía, se asume anual (12 meses).',
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

  @ApiPropertyOptional({
    example: false,
    description:
      'Incluir en la respuesta el texto crudo que devolvió el modelo (para depurar el prompt).',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeRaw?: boolean;
}
