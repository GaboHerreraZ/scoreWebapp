-- Banco de pruebas de extracción de PDF (portal admin): archiva el resultado de
-- cada corrida de /admin/pdf-extraction-test para poder revisarlo por nombre de
-- archivo sin volver a subir el PDF ni pagar otra corrida de IA. El PDF NO se
-- almacena. No hay FK a platform_admins: performed_by guarda el userId de
-- Supabase, misma convención que credit_study_resets.reset_by.
CREATE TABLE "pdf_extraction_tests" (
    "id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size_bytes" INTEGER,
    "income_statement_id" INTEGER,
    "fiscal_year" INTEGER,
    "response" JSONB NOT NULL,
    "raw_content" TEXT,
    "model" VARCHAR(100) NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost_usd" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "periods_count" INTEGER NOT NULL,
    "flags_count" INTEGER NOT NULL,
    "performed_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_extraction_tests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pdf_extraction_tests_file_name_idx" ON "pdf_extraction_tests"("file_name");

CREATE INDEX "pdf_extraction_tests_created_at_idx" ON "pdf_extraction_tests"("created_at");
