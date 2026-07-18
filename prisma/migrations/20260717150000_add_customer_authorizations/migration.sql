-- Autorización del titular consultado, firmada electrónicamente vía Zapsign.
-- La firma el TITULAR CONSULTADO (persona/empresa a evaluar) para que una EMPRESA
-- pueda consultarlo en centrales de riesgo. Es el gate del bureau: sin signed_at
-- (no revocado) no se puede consultar (ni crear Customer ni CreditStudy).
--
-- Se llavea por IDENTIDAD (company_id + identification_number + type_id), la misma
-- llave natural que customers, NO por customer_id: el Customer nace de la consulta,
-- que requiere esta firma. customer_id se rellena (backfill) tras la 1ª consulta.
--
-- created_at/updated_at se setean en el seed en SQL (los @default de Prisma son
-- del lado del cliente).

-- ── Seed de parámetros ──────────────────────────────────────────────────
-- Tipo de finalidad. 'core' = documento único (tratamiento + habeas data +
-- custodia). 'disclosure' = divulgación a terceros (facultativa, 2ª firma, luego).
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('customer_authorization_type', 'core', 'Autorización principal', 'Tratamiento de datos + Habeas Data + custodia (documento único)', true, 0, NOW(), NOW()),
  ('customer_authorization_type', 'disclosure', 'Divulgación a terceros', 'Autorización facultativa de divulgación a terceros (segunda firma)', true, 1, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- Estado de la firma (espeja company_contract_status).
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('customer_authorization_status', 'pending', 'Pendiente de firma', 'Documento enviado; esperando la firma del titular', true, 0, NOW(), NOW()),
  ('customer_authorization_status', 'signed', 'Firmada', 'El titular firmó la autorización', true, 1, NOW(), NOW()),
  ('customer_authorization_status', 'refused', 'Rechazada', 'El titular rechazó la firma', true, 2, NOW(), NOW()),
  ('customer_authorization_status', 'expired', 'Expirada', 'La autorización venció sin ser firmada', true, 3, NOW(), NOW()),
  ('customer_authorization_status', 'revoked', 'Revocada', 'El titular revocó una autorización previamente firmada', true, 4, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- ── Tabla customer_authorizations ───────────────────────────────────────
CREATE TABLE "customer_authorizations" (
    "id"                          UUID NOT NULL,
    "company_id"                  UUID NOT NULL,
    "type_id"                     INTEGER NOT NULL,
    "identification_type_id"      INTEGER NOT NULL,
    "identification_number"       VARCHAR(50) NOT NULL,
    "titular_name"                VARCHAR(255) NOT NULL,
    "titular_email"               VARCHAR(255) NOT NULL,
    "customer_id"                 UUID,
    "status_id"                   INTEGER NOT NULL,
    "template_id"                 VARCHAR(100) NOT NULL,
    "zapsign_doc_token"           VARCHAR(100) NOT NULL,
    "signer_token"                VARCHAR(100),
    "sign_url"                    VARCHAR(500),
    "signed_document_url"         VARCHAR(500),
    "signed_file_storage_path"    VARCHAR(500),
    "sent_at"                     TIMESTAMP(3),
    "signed_at"                   TIMESTAMP(3),
    "refused_at"                  TIMESTAMP(3),
    "refused_reason"              VARCHAR(1000),
    "revoked_at"                  TIMESTAMP(3),
    "revoked_by"                  UUID,
    "created_by"                  UUID NOT NULL,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_authorizations_pkey" PRIMARY KEY ("id")
);

-- Una autorización por titular/empresa/finalidad + token de documento único.
CREATE UNIQUE INDEX "customer_authorizations_company_id_identification_number_type_id_key"
  ON "customer_authorizations"("company_id", "identification_number", "type_id");
CREATE UNIQUE INDEX "customer_authorizations_zapsign_doc_token_key"
  ON "customer_authorizations"("zapsign_doc_token");
CREATE INDEX "customer_authorizations_status_id_idx" ON "customer_authorizations"("status_id");
CREATE INDEX "customer_authorizations_customer_id_idx" ON "customer_authorizations"("customer_id");

-- FKs
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_type_id_fkey"
  FOREIGN KEY ("type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_status_id_fkey"
  FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_identification_type_id_fkey"
  FOREIGN KEY ("identification_type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_revoked_by_fkey"
  FOREIGN KEY ("revoked_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
