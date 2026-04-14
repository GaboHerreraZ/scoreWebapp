-- Insert AI analysis type parameters
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('ai_analysis_type', 'creditReview', 'Estudio de crédito', 'Análisis IA del resultado de un estudio de crédito', true, 1, NOW(), NOW()),
  ('ai_analysis_type', 'financialStatementsPdfUpload', 'Carga PDF estados financieros', 'Extracción de datos financieros desde PDF con IA', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- AlterTable: add pdf_file and type_id (nullable first)
ALTER TABLE "ai_analyses" ADD COLUMN "pdf_file" BYTEA;
ALTER TABLE "ai_analyses" ADD COLUMN "type_id" INTEGER;

-- Backfill existing rows with 'creditReview' parameter id
UPDATE "ai_analyses"
SET "type_id" = (SELECT "id" FROM "parameters" WHERE "type" = 'ai_analysis_type' AND "code" = 'creditReview' LIMIT 1)
WHERE "type_id" IS NULL;

-- Now make type_id NOT NULL
ALTER TABLE "ai_analyses" ALTER COLUMN "type_id" SET NOT NULL;

-- AlterTable: add max_pdf_extractions_per_month to subscriptions
ALTER TABLE "subscriptions" ADD COLUMN "max_pdf_extractions_per_month" INTEGER;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
