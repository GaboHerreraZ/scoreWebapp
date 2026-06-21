-- Códigos promocionales: descuento porcentual sobre la compra de bolsas.
-- scope (Parameter promo_code_scope) define si aplica a una empresa o a todas.
-- El cupo se controla con max_redemptions vs redemptions_count (denormalizado
-- del ledger promo_code_redemptions). created_at/updated_at en SQL (los @default
-- de Prisma son client-side).

-- ── Seed de parámetros: scope del código ────────────────────────────────
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('promo_code_scope', 'company', 'Empresa específica', 'El código aplica solo a una empresa', true, 0, NOW(), NOW()),
  ('promo_code_scope', 'global', 'General', 'El código aplica a cualquier empresa, con cupo limitado', true, 1, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- Tipo de alerta para el caso borde: cupo agotado entre el inicio de la compra
-- y la confirmación del pago (la bolsa se activa con lo cobrado y se alerta).
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('payment_alert_type', 'promo_code_oversold', 'Cupo de código sobrevendido', 'El código se agotó entre el inicio de la compra y la confirmación del pago', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- ── Tabla: promo_codes ──────────────────────────────────────────────────
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "scope_id" INTEGER NOT NULL,
    "company_id" UUID,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "max_redemptions" INTEGER NOT NULL,
    "redemptions_count" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");
CREATE INDEX "promo_codes_code_idx" ON "promo_codes"("code");
CREATE INDEX "promo_codes_scope_id_is_active_idx" ON "promo_codes"("scope_id", "is_active");

ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Tabla: promo_code_redemptions (ledger) ──────────────────────────────
CREATE TABLE "promo_code_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "analysis_pack_id" UUID,
    "redeemed_by" UUID,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "discount_amount" DOUBLE PRECISION NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promo_code_redemptions_promo_code_id_company_id_key" ON "promo_code_redemptions"("promo_code_id", "company_id");
CREATE INDEX "promo_code_redemptions_promo_code_id_redeemed_at_idx" ON "promo_code_redemptions"("promo_code_id", "redeemed_at");

ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_analysis_pack_id_fkey" FOREIGN KEY ("analysis_pack_id") REFERENCES "analysis_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Snapshot del código aplicado en la bolsa ────────────────────────────
ALTER TABLE "analysis_packs" ADD COLUMN "promo_code_id" UUID;
ALTER TABLE "analysis_packs" ADD COLUMN "promo_discount_percent" DECIMAL(5,2);
ALTER TABLE "analysis_packs" ADD COLUMN "promo_discount_amount" DOUBLE PRECISION;
ALTER TABLE "analysis_packs" ADD COLUMN "promo_redeemed_by" UUID;

ALTER TABLE "analysis_packs" ADD CONSTRAINT "analysis_packs_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "analysis_packs" ADD CONSTRAINT "analysis_packs_promo_redeemed_by_fkey" FOREIGN KEY ("promo_redeemed_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
