-- ─── AlterTable: add bank account fields to companies ─────────────
ALTER TABLE "companies" ADD COLUMN "account_type_id" INTEGER;
ALTER TABLE "companies" ADD COLUMN "account_bank_id" INTEGER;
ALTER TABLE "companies" ADD COLUMN "account_number" VARCHAR(50);

-- ─── AlterTable: add identification type to customers ─────────────
ALTER TABLE "customers" ADD COLUMN "identification_type_id" INTEGER;

-- ─── CreateTable: promissory_notes ─────────────────────────────────
CREATE TABLE "promissory_notes" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "credit_study_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "status_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "amount_in_words" VARCHAR(500) NOT NULL,
    "docuseal_submission_id" INTEGER,
    "docuseal_submitter_id" INTEGER,
    "docuseal_submitter_uuid" VARCHAR(100),
    "docuseal_slug" VARCHAR(100),
    "signing_url" VARCHAR(500),
    "signed_document_url" VARCHAR(500),
    "signed_file_storage_path" VARCHAR(500),
    "sent_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promissory_notes_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ───────────────────────────────────────────────────────
CREATE INDEX "promissory_notes_company_id_idx" ON "promissory_notes"("company_id");
CREATE INDEX "promissory_notes_credit_study_id_idx" ON "promissory_notes"("credit_study_id");
CREATE INDEX "promissory_notes_customer_id_idx" ON "promissory_notes"("customer_id");
CREATE INDEX "promissory_notes_docuseal_submission_id_idx" ON "promissory_notes"("docuseal_submission_id");

-- ─── Foreign Keys ──────────────────────────────────────────────────
ALTER TABLE "companies" ADD CONSTRAINT "companies_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "companies" ADD CONSTRAINT "companies_account_bank_id_fkey" FOREIGN KEY ("account_bank_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customers" ADD CONSTRAINT "customers_identification_type_id_fkey" FOREIGN KEY ("identification_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_credit_study_id_fkey" FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Seed parameters ───────────────────────────────────────────────

-- Identification types
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('identification_type', 'cc', 'Cédula de Ciudadanía', NULL, true, 1, NOW(), NOW()),
  ('identification_type', 'ce', 'Cédula de Extranjería', NULL, true, 2, NOW(), NOW()),
  ('identification_type', 'nit', 'NIT', NULL, true, 3, NOW(), NOW()),
  ('identification_type', 'pa', 'Pasaporte', NULL, true, 4, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- Account types
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('account_type', 'savings', 'Ahorros', NULL, true, 1, NOW(), NOW()),
  ('account_type', 'checking', 'Corriente', NULL, true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- Banks
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('bank', 'bancolombia', 'Bancolombia', NULL, true, 1, NOW(), NOW()),
  ('bank', 'bancoBogota', 'Banco de Bogotá', NULL, true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- Promissory note statuses
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('promissory_note_status', 'pendingSignature', 'Pendiente de firma', NULL, true, 1, NOW(), NOW()),
  ('promissory_note_status', 'signed', 'Firmado', NULL, true, 2, NOW(), NOW()),
  ('promissory_note_status', 'declined', 'Rechazado', NULL, true, 3, NOW(), NOW()),
  ('promissory_note_status', 'expired', 'Expirado', NULL, true, 4, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
