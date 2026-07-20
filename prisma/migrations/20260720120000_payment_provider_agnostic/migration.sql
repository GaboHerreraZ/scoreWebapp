-- ─── Pagos agnósticos del proveedor ─────────────────────────────────────────
-- Renombra las columnas epayco_* → provider_* (RENAME, no DROP+ADD: se
-- conservan los datos) y agrega la columna provider (default 'epayco') en las
-- tablas de pago, para saber qué proveedor procesó cada registro si algún día
-- se cambia de pasarela. Mismo criterio que provider_doc_token en firmas.

-- companies: id del cliente en la pasarela
ALTER TABLE "companies"
  RENAME COLUMN "epayco_customer_id" TO "provider_customer_id";

-- analysis_packs: checkout + comprobante
ALTER TABLE "analysis_packs"
  RENAME COLUMN "epayco_session_id" TO "provider_session_id";
ALTER TABLE "analysis_packs"
  RENAME COLUMN "epayco_ref" TO "provider_reference";
ALTER TABLE "analysis_packs"
  RENAME COLUMN "epayco_transaction_id" TO "provider_transaction_id";
ALTER TABLE "analysis_packs"
  RENAME COLUMN "epayco_franchise" TO "provider_franchise";
ALTER TABLE "analysis_packs"
  RENAME COLUMN "epayco_card_last4" TO "provider_card_last4";
ALTER TABLE "analysis_packs"
  RENAME COLUMN "epayco_approval_code" TO "provider_approval_code";
ALTER TABLE "analysis_packs"
  RENAME COLUMN "epayco_response_reason" TO "provider_response_reason";
ALTER TABLE "analysis_packs"
  ADD COLUMN "provider" VARCHAR(50) NOT NULL DEFAULT 'epayco';

-- payment_events: log crudo de confirmaciones
ALTER TABLE "payment_events"
  RENAME COLUMN "epayco_ref" TO "provider_reference";
ALTER TABLE "payment_events"
  RENAME COLUMN "epayco_transaction_id" TO "provider_transaction_id";
ALTER TABLE "payment_events"
  ADD COLUMN "provider" VARCHAR(50) NOT NULL DEFAULT 'epayco';
ALTER INDEX "payment_events_epayco_transaction_id_idx"
  RENAME TO "payment_events_provider_transaction_id_idx";
