-- El epaycoPlanId estático del plan (Subscription) deja de usarse: el plan de
-- ePayco es dinámico por cliente y vive en company_subscriptions.epayco_plan_id.
-- El precio del plan se deriva de maxStudiesPerMonth × ConsultationPrice vigente.

-- DropColumn
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "epayco_plan_id";
