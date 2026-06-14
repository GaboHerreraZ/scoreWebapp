-- ─────────────────────────────────────────────────────────────────────────────
-- Flujo de pago en onboarding:
--   • company_subscriptions.epayco_plan_id: plan dinámico creado en ePayco para
--     ESTE cliente (monto personalizado = estudios × precio consulta).
--   • company_subscriptions.payment_token: secreto del link de pago enviado por
--     correo; permite cargar el resumen y pagar sin auth. Se invalida al pagar.
--   • Parámetro subscription_status = 'pending_payment': la suscripción nace en
--     este estado y pasa a 'active' cuando ePayco confirma el pago (webhook).
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "company_subscriptions"
  ADD COLUMN "epayco_plan_id" VARCHAR(100),
  ADD COLUMN "payment_token"  VARCHAR(64);

-- Seed: estado de suscripción "pendiente de pago".
-- created_at/updated_at en SQL (los defaults de Prisma son client-side). Idempotente.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('subscription_status', 'pending_payment', 'Pendiente de pago', 'La suscripción espera el pago inicial antes de activarse', true, 0, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
