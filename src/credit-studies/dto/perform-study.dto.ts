import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Fuentes que el usuario puede forzar para el cálculo. Son los MISMOS códigos
 * que expone el step2 en `sources[].source` (FinancialAnalysis.source), para
 * que el front mande tal cual el de la fuente que el usuario eligió.
 */
export const PERFORM_SOURCES = ['datacredito', 'pdf_upload'] as const;
export type PerformSource = (typeof PERFORM_SOURCES)[number];

export class PerformStudyDto {
  // Los EEFF que reporta la central a veces vienen incompletos (rubros en "-",
  // totales en 0) y el análisis automático saldría no viable injustamente. Con
  // este campo el usuario decide sobre qué fuente correr el cálculo; si se
  // omite, rige la regla automática (central si el año fiscal coincide con el
  // del PDF, si no, PDF).
  @ApiPropertyOptional({
    enum: PERFORM_SOURCES,
    description:
      'Fuente de EEFF a usar en el cálculo (selección manual del usuario). Omitir = selección automática.',
  })
  @IsOptional()
  @IsIn(PERFORM_SOURCES)
  source?: PerformSource;
}
