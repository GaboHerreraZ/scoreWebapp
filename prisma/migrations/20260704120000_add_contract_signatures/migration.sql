-- Contrato macro Creditia ↔ empresa cliente, firmado electrónicamente vía Zapsign.
-- Uno por empresa (company_id UNIQUE): se firma una sola vez en la vida de la
-- empresa. Se dispara al confirmarse el primer pago (webhook ePayco); Creditia
-- firma por API y el cliente recibe el sign_url. La cuenta NO queda activa hasta
-- que el cliente firma. status es Parameter 'company_contract_status'.
-- created_at/updated_at se setean en el seed en SQL (los @default de Prisma son
-- del lado del cliente).

-- ── Seed de parámetros de estado del contrato ───────────────────────────
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('company_contract_status', 'pending_contract', 'Pendiente de firma', 'Contrato enviado; esperando la firma del cliente', true, 0, NOW(), NOW()),
  ('company_contract_status', 'signed', 'Firmado', 'Contrato firmado por ambas partes', true, 1, NOW(), NOW()),
  ('company_contract_status', 'refused', 'Rechazado', 'El cliente rechazó la firma del contrato', true, 2, NOW(), NOW()),
  ('company_contract_status', 'expired', 'Expirado', 'El contrato venció sin ser firmado', true, 3, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- ── Tabla contract_signatures ───────────────────────────────────────────
CREATE TABLE "contract_signatures" (
    "id"                          UUID NOT NULL,
    "company_id"                  UUID NOT NULL,
    "template_id"                 VARCHAR(100) NOT NULL,
    "status_id"                   INTEGER NOT NULL,
    "zapsign_doc_token"           VARCHAR(100) NOT NULL,
    "client_signer_token"         VARCHAR(100),
    "sign_url"                    VARCHAR(500),
    "signed_document_url"         VARCHAR(500),
    "signed_file_storage_path"    VARCHAR(500),
    "signer_name"                 VARCHAR(255) NOT NULL,
    "signer_email"                VARCHAR(255) NOT NULL,
    "sent_at"                     TIMESTAMP(3),
    "signed_at"                   TIMESTAMP(3),
    "refused_at"                  TIMESTAMP(3),
    "refused_reason"              VARCHAR(1000),
    "first_viewed_at"             TIMESTAMP(3),
    "last_viewed_at"              TIMESTAMP(3),
    "view_count"                  INTEGER NOT NULL DEFAULT 0,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- Uno por empresa + token de documento único.
CREATE UNIQUE INDEX "contract_signatures_company_id_key" ON "contract_signatures"("company_id");
CREATE UNIQUE INDEX "contract_signatures_zapsign_doc_token_key" ON "contract_signatures"("zapsign_doc_token");
CREATE INDEX "contract_signatures_status_id_idx" ON "contract_signatures"("status_id");

-- FKs
ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_status_id_fkey"
  FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
