-- ─── Parte 1: modelo de firma agnóstico del proveedor ───────────────────────
-- Renombra zapsign_doc_token → provider_doc_token (RENAME, no DROP+ADD: los
-- tokens de documentos vivos se conservan) y agrega la columna provider para
-- saber en qué proveedor vive cada documento histórico si algún día se migra.

ALTER TABLE "contract_signatures"
  RENAME COLUMN "zapsign_doc_token" TO "provider_doc_token";
ALTER INDEX "contract_signatures_zapsign_doc_token_key"
  RENAME TO "contract_signatures_provider_doc_token_key";
ALTER TABLE "contract_signatures"
  ADD COLUMN "provider" VARCHAR(50) NOT NULL DEFAULT 'zapsign';

ALTER TABLE "customer_authorizations"
  RENAME COLUMN "zapsign_doc_token" TO "provider_doc_token";
ALTER INDEX "customer_authorizations_zapsign_doc_token_key"
  RENAME TO "customer_authorizations_provider_doc_token_key";
ALTER TABLE "customer_authorizations"
  ADD COLUMN "provider" VARCHAR(50) NOT NULL DEFAULT 'zapsign';

-- ─── Parte 2: pagaré — consecutivo por empresa + firma vía proveedor ────────
-- Columnas nuevas: numeración, snapshot editable (plazo/vencimiento), snapshot
-- del acreedor y el trío del proveedor de firma (nullables: las filas de la era
-- DocuSeal no los tienen).

ALTER TABLE "promissory_notes"
  ADD COLUMN "note_number"             INTEGER,
  ADD COLUMN "term_days"               INTEGER,
  ADD COLUMN "due_date"                DATE,
  ADD COLUMN "sign_city"               VARCHAR(150),
  ADD COLUMN "creditor_address"        VARCHAR(255),
  ADD COLUMN "creditor_account_type"   VARCHAR(100),
  ADD COLUMN "creditor_account_number" VARCHAR(50),
  ADD COLUMN "creditor_bank"           VARCHAR(150),
  ADD COLUMN "provider"                VARCHAR(50) NOT NULL DEFAULT 'zapsign',
  ADD COLUMN "provider_doc_token"      VARCHAR(100),
  ADD COLUMN "signer_token"            VARCHAR(100),
  ADD COLUMN "template_id"             VARCHAR(100),
  ADD COLUMN "refused_reason"          VARCHAR(1000);

-- Backfill del consecutivo para pagarés históricos: por empresa, en orden de
-- creación (id como desempate de mismo instante).
UPDATE "promissory_notes" pn
SET "note_number" = numbered.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at, id) AS rn
  FROM "promissory_notes"
) numbered
WHERE pn.id = numbered.id;

ALTER TABLE "promissory_notes"
  ALTER COLUMN "note_number" SET NOT NULL;

CREATE UNIQUE INDEX "promissory_notes_company_id_note_number_key"
  ON "promissory_notes"("company_id", "note_number");
CREATE UNIQUE INDEX "promissory_notes_provider_doc_token_key"
  ON "promissory_notes"("provider_doc_token");
