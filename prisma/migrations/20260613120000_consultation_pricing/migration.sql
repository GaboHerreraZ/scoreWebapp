-- ─────────────────────────────────────────────────────────────────────────────
-- Consultation pricing: cobro por consulta (estudio).
--   • Se elimina `price` de subscriptions: el precio del plan ahora es derivado
--     (maxStudiesPerMonth × unitPrice del ConsultationPrice vigente).
--   • Se eliminan beneficios que pasan a ser por defecto en todos los planes:
--     excel_reports, dashboard_level_id, email_notifications,
--     theme_customization, support_level_id.
--   • Se agrega auditoría: subscriptions.created_by.
--   • Nueva tabla consultation_prices (valor unitario versionado, con promos).
--   • company_subscriptions referencia el ConsultationPrice usado para congelar
--     el precio (pricePaid ya existente queda como total congelado).
-- NOTA: created_by en subscriptions es NULLABLE para no romper planes existentes.
-- ─────────────────────────────────────────────────────────────────────────────

-- DropForeignKey (beneficios retirados)
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_dashboard_level_id_fkey";
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_support_level_id_fkey";

-- AlterTable subscriptions: retirar price y beneficios por-defecto; agregar auditoría
ALTER TABLE "subscriptions"
  DROP COLUMN "price",
  DROP COLUMN "dashboard_level_id",
  DROP COLUMN "excel_reports",
  DROP COLUMN "email_notifications",
  DROP COLUMN "theme_customization",
  DROP COLUMN "support_level_id",
  ADD COLUMN  "created_by" UUID;

-- CreateTable consultation_prices
CREATE TABLE "consultation_prices" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "has_discount" BOOLEAN NOT NULL DEFAULT false,
    "base_price" DOUBLE PRECISION,
    "discount_type_id" INTEGER,
    "discount_value" DOUBLE PRECISION,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_prices_pkey" PRIMARY KEY ("id")
);

-- AlterTable company_subscriptions: referencia al precio congelado
ALTER TABLE "company_subscriptions" ADD COLUMN "consultation_price_id" UUID;

-- AddForeignKey (auditoría: planes y precios los crea el equipo Creditia → platform_admins)
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "consultation_prices" ADD CONSTRAINT "consultation_prices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "consultation_prices" ADD CONSTRAINT "consultation_prices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "consultation_prices" ADD CONSTRAINT "consultation_prices_discount_type_id_fkey" FOREIGN KEY ("discount_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_consultation_price_id_fkey" FOREIGN KEY ("consultation_price_id") REFERENCES "consultation_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
