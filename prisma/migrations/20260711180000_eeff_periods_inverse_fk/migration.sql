-- Rediseño EEFF: N períodos por análisis (antes máximo 2).
--
-- Se invierte la relación: en vez de que FinancialAnalysis apunte a un par fijo
-- (current_period_id / prior_period_id), ahora los FinancialStatementPeriod
-- cuelgan del análisis vía analysis_id. Así un análisis puede tener 2, 3 o N
-- años (PDF/DataCrédito). El corriente/anterior para los indicadores se resuelve
-- por fiscal_year DESC (los 2 más recientes), sin campo que los marque.
--
-- Datos de prueba previos: los análisis existentes quedan sin períodos ligados
-- (analysis_id era NULL en los períodos viejos); se limpian para no dejar filas
-- huérfanas. Entorno con datos desechables.
--
-- NOTA: se OMITE el DROP TABLE _data_migrations y el ruido de drift (invitations
-- fkey, platform_admins default) del diff automático. Ver CLAUDE.md.

-- DropForeignKey (antes de borrar filas: las FKs viejas impiden el DELETE de
-- periods mientras analyses aún los referencia).
ALTER TABLE "financial_analyses" DROP CONSTRAINT "financial_analyses_current_period_id_fkey";
ALTER TABLE "financial_analyses" DROP CONSTRAINT "financial_analyses_prior_period_id_fkey";

-- Limpieza de datos de prueba huérfanos (join → análisis → períodos del modelo viejo).
DELETE FROM "credit_study_financial_analyses";
DELETE FROM "financial_analyses";
DELETE FROM "financial_statement_periods";

-- AlterTable: FinancialAnalysis pierde las 2 FKs al par de períodos.
ALTER TABLE "financial_analyses" DROP COLUMN "current_period_id",
DROP COLUMN "prior_period_id";

-- AlterTable: el período gana la FK inversa al análisis.
ALTER TABLE "financial_statement_periods" ADD COLUMN "analysis_id" UUID;

-- CreateIndex
CREATE INDEX "financial_statement_periods_analysis_id_idx" ON "financial_statement_periods"("analysis_id");

-- AddForeignKey
ALTER TABLE "financial_statement_periods" ADD CONSTRAINT "financial_statement_periods_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "financial_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
