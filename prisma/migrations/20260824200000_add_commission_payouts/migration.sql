-- Lotes de liquidación de comisiones.
--
-- Al vendedor se le hace UNA transferencia al mes por todas sus comisiones, no
-- una por venta. Cada lote es ese giro: agrupa N comisiones, congela el total y
-- da una referencia estable para el comprobante que se le envía por correo.
--
-- Revertir es a nivel de lote (un giro se devuelve entero): las comisiones
-- vuelven a 'pending' y el lote queda marcado como revertido, sin borrarse, para
-- que el histórico muestre que existió.

CREATE TABLE "commission_payouts" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference"        VARCHAR(30) NOT NULL,
    "sales_rep_id"     UUID NOT NULL,

    -- Snapshot al liquidar. NO se recalcula desde las líneas: un comprobante ya
    -- emitido tiene que seguir diciendo lo mismo para siempre.
    "commission_count" INTEGER NOT NULL,
    "total_amount"     DOUBLE PRECISION NOT NULL,
    "currency_code"    VARCHAR(10) NOT NULL DEFAULT 'COP',

    -- Rango que cubre el giro, para el comprobante ('YYYY-MM').
    "from_month"       VARCHAR(7),
    "to_month"         VARCHAR(7),

    "notes"            VARCHAR(500),
    "paid_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by"          UUID,

    "reverted_at"      TIMESTAMP(3),
    "reverted_by"      UUID,
    "revert_reason"    VARCHAR(500),

    "receipt_sent_at"  TIMESTAMP(3),

    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_payouts_reference_key" ON "commission_payouts"("reference");
CREATE INDEX "commission_payouts_sales_rep_id_paid_at_idx" ON "commission_payouts"("sales_rep_id", "paid_at");

ALTER TABLE "commission_payouts"
  ADD CONSTRAINT "commission_payouts_sales_rep_id_fkey"
  FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commission_payouts"
  ADD CONSTRAINT "commission_payouts_paid_by_fkey"
  FOREIGN KEY ("paid_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commission_payouts"
  ADD CONSTRAINT "commission_payouts_reverted_by_fkey"
  FOREIGN KEY ("reverted_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cada comisión sabe en qué giro se pagó. NULL = se marcó suelta, una a una.
-- ON DELETE SET NULL: si algún día se depura un lote viejo, la comisión no se va
-- con él (es el ledger).
ALTER TABLE "sales_commissions"
  ADD COLUMN IF NOT EXISTS "payout_id" UUID;

ALTER TABLE "sales_commissions"
  ADD CONSTRAINT "sales_commissions_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "commission_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "sales_commissions_payout_id_idx" ON "sales_commissions"("payout_id");
