-- Remove campaigns: el modelo de cobro cambia a contrato anual con nivel mensual
-- configurable (admin portal). Las campañas aplicaban descuentos a los planes
-- empaquetados, que dejan de usarse.

-- DropForeignKey
ALTER TABLE "company_subscriptions"
  DROP CONSTRAINT IF EXISTS "company_subscriptions_campaign_id_fkey";

-- DropColumn
ALTER TABLE "company_subscriptions"
  DROP COLUMN IF EXISTS "campaign_id";

-- DropTable
DROP TABLE IF EXISTS "campaigns";
