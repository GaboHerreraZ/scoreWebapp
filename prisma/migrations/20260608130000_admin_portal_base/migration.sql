-- Admin portal — capa de datos base (aditiva, no toca lo existente).

-- 1. contractId en company_subscriptions: agrupa los tramos (registros) de un
--    mismo contrato anual cuando hay cambios de nivel. Nullable para no afectar
--    registros existentes.
ALTER TABLE "company_subscriptions" ADD COLUMN IF NOT EXISTS "contract_id" UUID;

-- 2. Tabla platform_admins: identidad del equipo Creditia con acceso al portal.
--    user_id es el id de Supabase auth.users.
CREATE TABLE IF NOT EXISTS "platform_admins" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID         NOT NULL,
  "email"      VARCHAR(255) NOT NULL,
  "is_active"  BOOLEAN      NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admins_user_id_key" ON "platform_admins"("user_id");

-- 3. Parámetros nuevos (idempotentes).
INSERT INTO parameters (type, code, label, description, is_active, sort_order, created_at, updated_at)
VALUES
  ('subscription_status', 'superseded', 'Reemplazada', 'Suscripción reemplazada por un cambio de nivel (no es una baja)', true, 0, NOW(), NOW()),
  ('user_company_role', 'owner', 'Propietario', 'Dueño o responsable de la empresa cliente (alta por onboarding)', true, 0, NOW(), NOW())
ON CONFLICT (type, code) DO NOTHING;
