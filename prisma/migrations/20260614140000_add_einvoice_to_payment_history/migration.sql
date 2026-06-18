-- Facturación electrónica por cobro recurrente. Cada fila de payment_history
-- corresponde a un cobro; la factura electrónica se emite por cobro y de momento
-- se marca manualmente desde el portal admin.
--   einvoice_sent     = false: pendiente por enviar | true: ya enviada
--   einvoice_sent_at  = sello de cuándo se marcó como enviada (null si pendiente)
--   einvoice_number   = folio/número de la factura emitida (null si pendiente)

-- AddColumn
ALTER TABLE "payment_history"
  ADD COLUMN IF NOT EXISTS "einvoice_sent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "einvoice_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "einvoice_number" VARCHAR(100);
