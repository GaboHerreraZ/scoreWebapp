-- Auditoría de resets de estudio (soporte): snapshot del estado previo antes de
-- limpiar los análisis congelados y devolver el estudio al paso 2 (carga EEFF).
CREATE TABLE "credit_study_resets" (
    "id" UUID NOT NULL,
    "credit_study_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ticket_ref" VARCHAR(100),
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reset_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_study_resets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credit_study_resets_credit_study_id_idx" ON "credit_study_resets"("credit_study_id");

CREATE INDEX "credit_study_resets_company_id_created_at_idx" ON "credit_study_resets"("company_id", "created_at");

ALTER TABLE "credit_study_resets" ADD CONSTRAINT "credit_study_resets_credit_study_id_fkey" FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
