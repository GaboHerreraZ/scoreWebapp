-- Programa de referidos: vendedores que recomiendan Creditia y ganan un % de
-- lo que facture la empresa que trajeron.
--
-- Cuatro piezas:
--   commission_plans   → los dos % vigentes (primera compra vs recompras)
--   sales_reps         → el vendedor y su CÓDIGO (1:1 con su cuenta del portal)
--   company_referrals  → qué vendedor trajo qué empresa (con los % congelados)
--   sales_commissions  → ledger: una fila por bolsa pagada, causada en el webhook
--
-- La comisión se calcula sobre analysis_packs.tax_base (base gravable): el IVA
-- no es ingreso de Creditia y el descuento promocional ya viene aplicado ahí.

-- Estados de una comisión.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('sales_commission_status', 'pending', 'Pendiente', 'Comisión causada, pendiente de liquidar al vendedor', true, 0, NOW(), NOW()),
  ('sales_commission_status', 'paid', 'Pagada', 'Comisión ya liquidada al vendedor', true, 1, NOW(), NOW()),
  ('sales_commission_status', 'cancelled', 'Anulada', 'Comisión anulada (reversa del pago u otro ajuste)', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- CreateTable
CREATE TABLE "commission_plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "new_customer_percent" DECIMAL(5,2) NOT NULL,
    "recurring_percent" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_plans_is_active_idx" ON "commission_plans"("is_active");

-- CreateTable
CREATE TABLE "sales_reps" (
    "id" UUID NOT NULL,
    "platform_admin_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_reps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_reps_platform_admin_id_key" ON "sales_reps"("platform_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_reps_code_key" ON "sales_reps"("code");

-- CreateTable
-- company_id es la PK: una empresa la trae UN solo vendedor (reasignar = UPDATE).
CREATE TABLE "company_referrals" (
    "company_id" UUID NOT NULL,
    "sales_rep_id" UUID NOT NULL,
    "commission_plan_id" UUID NOT NULL,
    "new_customer_percent" DECIMAL(5,2) NOT NULL,
    "recurring_percent" DECIMAL(5,2) NOT NULL,
    "assigned_by" UUID,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_referrals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "company_referrals_sales_rep_id_idx" ON "company_referrals"("sales_rep_id");

-- CreateTable
-- analysis_pack_id es UNIQUE: una venta jamás comisiona dos veces, aunque el
-- webhook de pago llegue repetido.
CREATE TABLE "sales_commissions" (
    "id" UUID NOT NULL,
    "analysis_pack_id" UUID NOT NULL,
    "sales_rep_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "company_referral_id" UUID NOT NULL,
    "commission_plan_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "percent_applied" DECIMAL(5,2) NOT NULL,
    "base_amount" DOUBLE PRECISION NOT NULL,
    "commission_amount" DOUBLE PRECISION NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "accrual_month" VARCHAR(7) NOT NULL,
    "accrued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_id" INTEGER NOT NULL,
    "paid_at" TIMESTAMP(3),
    "paid_by" UUID,
    "payout_notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_commissions_analysis_pack_id_key" ON "sales_commissions"("analysis_pack_id");

-- CreateIndex
CREATE INDEX "sales_commissions_sales_rep_id_accrual_month_idx" ON "sales_commissions"("sales_rep_id", "accrual_month");

-- CreateIndex
CREATE INDEX "sales_commissions_accrual_month_idx" ON "sales_commissions"("accrual_month");

-- CreateIndex
CREATE INDEX "sales_commissions_status_id_accrual_month_idx" ON "sales_commissions"("status_id", "accrual_month");

-- AddForeignKey
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_platform_admin_id_fkey"
    FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_referrals" ADD CONSTRAINT "company_referrals_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_referrals" ADD CONSTRAINT "company_referrals_sales_rep_id_fkey"
    FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_referrals" ADD CONSTRAINT "company_referrals_commission_plan_id_fkey"
    FOREIGN KEY ("commission_plan_id") REFERENCES "commission_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_referrals" ADD CONSTRAINT "company_referrals_assigned_by_fkey"
    FOREIGN KEY ("assigned_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_analysis_pack_id_fkey"
    FOREIGN KEY ("analysis_pack_id") REFERENCES "analysis_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_sales_rep_id_fkey"
    FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_company_referral_id_fkey"
    FOREIGN KEY ("company_referral_id") REFERENCES "company_referrals"("company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_commission_plan_id_fkey"
    FOREIGN KEY ("commission_plan_id") REFERENCES "commission_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_status_id_fkey"
    FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_paid_by_fkey"
    FOREIGN KEY ("paid_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Plan inicial 30% / 10%, para que el módulo arranque configurado. Si ya hay uno
-- vigente (re-ejecución), no se inserta un segundo.
INSERT INTO "commission_plans" ("id", "name", "new_customer_percent", "recurring_percent", "is_active", "notes", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Plan inicial', 30.00, 10.00, true,
       'Plan por defecto del programa de referidos', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "commission_plans" WHERE "is_active" = true);
