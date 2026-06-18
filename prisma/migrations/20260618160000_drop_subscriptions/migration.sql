-- ─────────────────────────────────────────────────────────────────────────────
-- Eliminación del modelo de SUSCRIPCIONES (reemplazado por bolsas de análisis).
-- Borra las 3 tablas del modelo viejo y sus FKs:
--   • payment_history        (historial de cobros recurrentes)
--   • company_subscriptions  (suscripción ↔ empresa)
--   • subscriptions          (planes)
-- El respaldo completo del código + schema viejo está en el tag git
-- `subscriptions-model-snapshot`.
-- NOTA: NO se toca _data_migrations ni platform_admins.id ni el FK de
-- invitations_invited_by; el drift que `migrate diff` sugiere sobre ellos es
-- esperado y se ignora (ver CLAUDE.md).
-- ─────────────────────────────────────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "payment_history" DROP CONSTRAINT IF EXISTS "payment_history_company_subscription_id_fkey";

ALTER TABLE "company_subscriptions" DROP CONSTRAINT IF EXISTS "company_subscriptions_company_id_fkey";
ALTER TABLE "company_subscriptions" DROP CONSTRAINT IF EXISTS "company_subscriptions_consultation_price_id_fkey";
ALTER TABLE "company_subscriptions" DROP CONSTRAINT IF EXISTS "company_subscriptions_status_id_fkey";
ALTER TABLE "company_subscriptions" DROP CONSTRAINT IF EXISTS "company_subscriptions_subscription_id_fkey";

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_created_by_fkey";

-- DropTable (en orden de dependencia: payment_history → company_subscriptions → subscriptions)
DROP TABLE IF EXISTS "payment_history";
DROP TABLE IF EXISTS "company_subscriptions";
DROP TABLE IF EXISTS "subscriptions";
