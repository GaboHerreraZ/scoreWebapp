-- ─── Retiro de DocuSeal ──────────────────────────────────────────────────────
-- Se elimina la integración de firma DocuSeal (los pagarés se reconectarán al
-- proveedor de firma vigente cuando se retome el flujo). Se dropean las
-- columnas específicas del proveedor en promissory_notes; las genéricas de
-- firma (signing_url, signed_document_url, signed_file_storage_path, sent_at,
-- signed_at, declined_at) se conservan.

DROP INDEX IF EXISTS "promissory_notes_docuseal_submission_id_idx";

ALTER TABLE "promissory_notes"
    DROP COLUMN IF EXISTS "docuseal_submission_id",
    DROP COLUMN IF EXISTS "docuseal_submitter_id",
    DROP COLUMN IF EXISTS "docuseal_submitter_uuid",
    DROP COLUMN IF EXISTS "docuseal_slug";
