-- Reintroduce subscriptions.epayco_plan_id, ahora con semántica de PLAN ESTÁTICO.
-- null  = plan dinámico: el plan ePayco se crea por empresa en el onboarding.
-- valor = plan de catálogo precreado en ePayco; su id_plan se reutiliza en cada
--         cobro, con el monto congelado al momento de crear el plan.

-- AddColumn
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "epayco_plan_id" VARCHAR(255);
