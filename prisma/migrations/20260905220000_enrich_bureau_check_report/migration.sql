-- Enriquecimiento del informe de la consulta de riesgo (bureauCheck):
--  * customer_risk_snapshots: narrativas de riesgo PN (probabilidad/recaudos) y
--    evolución trimestral saldo/cuota. Solo consultas NUEVAS las traen.
--  * customers: nacionalidad reportada por la central (PN).
--  * bureau_check_analyses: próximos pasos recomendados por la IA.

ALTER TABLE "customer_risk_snapshots" ADD COLUMN IF NOT EXISTS "txt_probabilidad" TEXT;
ALTER TABLE "customer_risk_snapshots" ADD COLUMN IF NOT EXISTS "txt_recaudos" TEXT;
ALTER TABLE "customer_risk_snapshots" ADD COLUMN IF NOT EXISTS "balance_evolution" JSONB;

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "nationality" VARCHAR(50);

ALTER TABLE "bureau_check_analyses" ADD COLUMN IF NOT EXISTS "recommendations" JSONB;
