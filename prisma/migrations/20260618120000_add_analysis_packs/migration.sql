-- ─────────────────────────────────────────────────────────────────────────────
-- Bolsas de análisis (packs de consultas prepago) — reemplaza el modelo de
-- suscripción recurrente por compra única con saldo y vigencia.
--   • pack_offerings        = catálogo configurable (lo que ve el front).
--                             Precio derivado = quantity × ConsultationPrice
--                             vigente − descuento por volumen opcional.
--   • analysis_packs        = compra concreta de una empresa. Pago ÚNICO ePayco.
--                             Precio CONGELADO (unit_price_paid/total_paid).
--                             Saldo = quantity_purchased − quantity_consumed.
--   • analysis_consumptions = ledger: 1 fila por CreditStudy creado.
--                             credit_study_id UNIQUE → 1 crédito = 1 estudio.
-- NOTA: NO toca _data_migrations ni otras tablas; el drift que reporta
-- `migrate diff` sobre _data_migrations es esperado y se ignora (ver CLAUDE.md).
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "pack_offerings" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "quantity" INTEGER NOT NULL,
    "validity_days" INTEGER NOT NULL DEFAULT 365,
    "has_discount" BOOLEAN NOT NULL DEFAULT false,
    "discount_type_id" INTEGER,
    "discount_value" DOUBLE PRECISION,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pack_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_packs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pack_offering_id" UUID,
    "quantity_purchased" INTEGER NOT NULL,
    "quantity_consumed" INTEGER NOT NULL DEFAULT 0,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "unit_price_paid" DOUBLE PRECISION NOT NULL,
    "total_paid" DOUBLE PRECISION NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "consultation_price_id" UUID,
    "status_id" INTEGER NOT NULL,
    "epayco_ref" VARCHAR(100),
    "epayco_transaction_id" VARCHAR(100),
    "payment_token" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_consumptions" (
    "id" UUID NOT NULL,
    "pack_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "credit_study_id" UUID NOT NULL,
    "consumed_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_packs_company_id_status_id_end_date_idx" ON "analysis_packs"("company_id", "status_id", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_consumptions_credit_study_id_key" ON "analysis_consumptions"("credit_study_id");

-- CreateIndex
CREATE INDEX "analysis_consumptions_company_id_created_at_idx" ON "analysis_consumptions"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "pack_offerings" ADD CONSTRAINT "pack_offerings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_offerings" ADD CONSTRAINT "pack_offerings_discount_type_id_fkey" FOREIGN KEY ("discount_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_packs" ADD CONSTRAINT "analysis_packs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_packs" ADD CONSTRAINT "analysis_packs_pack_offering_id_fkey" FOREIGN KEY ("pack_offering_id") REFERENCES "pack_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_packs" ADD CONSTRAINT "analysis_packs_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_packs" ADD CONSTRAINT "analysis_packs_consultation_price_id_fkey" FOREIGN KEY ("consultation_price_id") REFERENCES "consultation_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_consumptions" ADD CONSTRAINT "analysis_consumptions_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "analysis_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_consumptions" ADD CONSTRAINT "analysis_consumptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_consumptions" ADD CONSTRAINT "analysis_consumptions_credit_study_id_fkey" FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_consumptions" ADD CONSTRAINT "analysis_consumptions_consumed_by_fkey" FOREIGN KEY ("consumed_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: estados de la bolsa de análisis (status_id → Parameter 'analysis_pack_status').
-- pending_payment = creada, esperando confirmación de pago | active = pagada y con saldo
-- depleted = saldo agotado | expired = vencida (endDate pasada) | cancelled = anulada.
-- Idempotente. created_at/updated_at en SQL (los @default de Prisma son client-side).
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('analysis_pack_status', 'pending_payment', 'Pendiente de pago', 'Bolsa creada, esperando confirmación de pago', true, 0, NOW(), NOW()),
  ('analysis_pack_status', 'active', 'Activa', 'Bolsa pagada y con saldo disponible', true, 1, NOW(), NOW()),
  ('analysis_pack_status', 'depleted', 'Agotada', 'Bolsa sin saldo disponible (consumida por completo)', true, 2, NOW(), NOW()),
  ('analysis_pack_status', 'expired', 'Vencida', 'Bolsa fuera de su periodo de vigencia', true, 3, NOW(), NOW()),
  ('analysis_pack_status', 'cancelled', 'Anulada', 'Bolsa cancelada', true, 4, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
