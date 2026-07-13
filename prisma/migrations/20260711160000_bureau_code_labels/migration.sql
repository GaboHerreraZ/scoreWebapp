-- Promoción a dominio de los catálogos de códigos de Experian (Manual MiDecisor,
-- Tablas 1-15). Agrega la descripción del manual junto a cada código y promueve
-- los bloques temporales (que cambian por consulta) al snapshot inmutable.
--
--   * codigos_respuesta_labeled (Tabla 1): [{clave,valor,descripcion}] en la consulta.
--   * *_label en customer_risk_snapshots (Tablas 11-14): descripción de los códigos
--     escalares de riesgo (viabilidad/ratingRecaudos/nivel/ratingSectorial).
--   * JSONB en customer_risk_snapshots: credit_portfolio (Tabla 8, PJ),
--     payment_behavior (Tabla 9, PN+PJ), credit_sectors (Tabla 10, PN+PJ),
--     link_network (Tabla 15, PJ) — con sus labels ya incluidos.
--
-- NOTA: se OMITE el DROP TABLE _data_migrations y el ruido de drift (invitations
-- fkey, platform_admins default) que sugiere el diff automático. Ver CLAUDE.md.

-- AlterTable
ALTER TABLE "credit_bureau_consultations" ADD COLUMN "codigos_respuesta_labeled" JSONB;

-- AlterTable
ALTER TABLE "customer_risk_snapshots" ADD COLUMN "credit_portfolio" JSONB,
ADD COLUMN "credit_sectors" JSONB,
ADD COLUMN "link_network" JSONB,
ADD COLUMN "nivel_riesgo_label" VARCHAR(80),
ADD COLUMN "payment_behavior" JSONB,
ADD COLUMN "rating_recaudos_label" VARCHAR(255),
ADD COLUMN "rating_sectorial_label" VARCHAR(80),
ADD COLUMN "viabilidad_label" VARCHAR(80);
