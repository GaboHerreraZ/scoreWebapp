-- IVA + facturación electrónica de las bolsas de análisis.
--
-- 1. La tarifa de IVA vive en consultation_prices (no en 'parameters') porque
--    cambia con el tiempo y una factura vieja debe reconstruirse con la tarifa
--    que rigió: consultation_prices ya es la entidad versionada del precio y
--    analysis_packs.consultation_price_id apunta a la que se usó.
--      tax_rate     = porcentaje (19 = 19%)
--      tax_included = true  → unit_price YA trae el IVA (se desglosa hacia atrás)
--                     false → unit_price es base gravable y el IVA se suma
--    Default true para NO cambiar lo que hoy se le cobra al cliente: los precios
--    del catálogo se venían tratando como precio final.
ALTER TABLE "consultation_prices"
  ADD COLUMN IF NOT EXISTS "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS "tax_included" BOOLEAN NOT NULL DEFAULT true;

-- 2. Desglose fiscal CONGELADO en la bolsa al momento de la compra.
--    Invariante: total_paid = tax_base + tax_amount.
ALTER TABLE "analysis_packs"
  ADD COLUMN IF NOT EXISTS "tax_rate_paid" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "tax_base" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "tax_amount" DOUBLE PRECISION;

-- 3. Facturación electrónica: se emite fuera del sistema y se marca aquí desde
--    el panel admin (mismo esquema que usaba payment_history antes de las bolsas).
ALTER TABLE "analysis_packs"
  ADD COLUMN IF NOT EXISTS "einvoice_sent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "einvoice_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "einvoice_number" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "einvoice_marked_by" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analysis_packs_einvoice_marked_by_fkey'
  ) THEN
    ALTER TABLE "analysis_packs"
      ADD CONSTRAINT "analysis_packs_einvoice_marked_by_fkey"
      FOREIGN KEY ("einvoice_marked_by") REFERENCES "platform_admins"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Cola de pendientes por facturar (einvoice_sent = false ordenado por pago).
CREATE INDEX IF NOT EXISTS "analysis_packs_einvoice_sent_paid_at_idx"
  ON "analysis_packs" ("einvoice_sent", "paid_at");

-- 4. Backfill del desglose fiscal de las bolsas YA pagadas, con la tarifa por
--    defecto (19%) e IVA incluido, que es como se cobraron. Solo toca filas con
--    cobro real y sin desglose; las bolsas sin costo quedan en 0.
UPDATE "analysis_packs"
SET "tax_rate_paid" = 19,
    "tax_base"      = ROUND(("total_paid" / 1.19)::numeric, 2),
    "tax_amount"    = "total_paid" - ROUND(("total_paid" / 1.19)::numeric, 2)
WHERE "tax_rate_paid" IS NULL AND "total_paid" > 0;

UPDATE "analysis_packs"
SET "tax_rate_paid" = 19, "tax_base" = 0, "tax_amount" = 0
WHERE "tax_rate_paid" IS NULL AND "total_paid" = 0;

-- 5. Nuevo tipo de alerta: pago aprobado. A diferencia de los otros tipos (que
--    señalan problemas), este es informativo y existe para que facturación se
--    entere del cobro. Idempotente; created_at/updated_at explícitos porque los
--    @default de Prisma son client-side.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('payment_alert_type', 'payment_approved', 'Pago aprobado', 'Una compra de bolsa fue pagada y activada (pendiente de facturar)', true, 3, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
