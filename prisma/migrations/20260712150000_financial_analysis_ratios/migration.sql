-- Ratios financieros estándar de presentación (ROA, ROE, márgenes, razón
-- corriente, prueba ácida, apalancamiento, crecimiento, variaciones, etc.).
-- Bloque de display para el step2, calculado igual para PDF y DataCrédito. No
-- alimenta la viabilidad. JSONB nullable → no destructiva.
--
-- NOTA: se OMITE el ruido del diff automático (DROP TABLE _data_migrations,
-- invitations fkey drop/re-add, platform_admins default). Ver CLAUDE.md.

-- AlterTable
ALTER TABLE "financial_analyses" ADD COLUMN "ratios" JSONB;
