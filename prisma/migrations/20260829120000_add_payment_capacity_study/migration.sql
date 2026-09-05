-- Estudio de capacidad de pago (PN sin EEFF).
-- Diseño: docs/estudio-persona-natural-diseno.md (v0.3) y
-- docs/estudio-persona-natural-extraccion.md (v0.2).
-- Introduce: discriminador de tipo de estudio en credit_studies, documentos del
-- estudio (PDFs en Storage + extracción), indicadores calculados, y el eje de
-- tipo de estudio en la configuración de scoring.

-- 1) Parámetros nuevos ---------------------------------------------------
INSERT INTO "parameters" ("type","code","label","description","is_active","sort_order","created_at","updated_at") VALUES
  ('study_type','financialStatements','Estudio empresarial','Estudio de crédito con estados financieros (persona natural o jurídica)',true,0,NOW(),NOW()),
  ('study_type','paymentCapacity','Estudio de capacidad de pago','Persona natural evaluada con extractos bancarios y comprobantes de ingreso',true,1,NOW(),NOW()),
  ('study_document_type','bankStatement','Extracto bancario','Movimientos de la cuenta donde el titular recibe su ingreso',true,0,NOW(),NOW()),
  ('study_document_type','payrollStub','Desprendible de nómina','Comprobante de pago del empleador (perfil asalariado)',true,1,NOW(),NOW()),
  ('study_document_type','contractorInvoice','Factura / cuenta de cobro','Factura recurrente del independiente con clientes fijos',true,2,NOW(),NOW()),
  ('employment_type','salaried','Asalariado','Recibe nómina formal de un empleador',true,0,NOW(),NOW()),
  ('employment_type','independent','Independiente','Ingresos variables: ventas, honorarios, contratos',true,1,NOW(),NOW()),
  ('ai_analysis_type','bankStatementPdfExtraction','Extracción de extracto bancario','Corrida IA que extrae movimientos y resumen de un extracto',true,0,NOW(),NOW()),
  ('ai_analysis_type','payrollStubPdfExtraction','Extracción de desprendible de nómina','Corrida IA que extrae conceptos y neto de un desprendible',true,0,NOW(),NOW()),
  ('ai_analysis_type','contractorInvoicePdfExtraction','Extracción de factura de contratista','Corrida IA que extrae los datos de una factura recurrente',true,0,NOW(),NOW())
ON CONFLICT ("type","code") DO NOTHING;

-- 2) Catálogo de dimensiones: las 4 nuevas del estudio de capacidad ------
-- (paymentCapacity y centralRisk se REUSAN del catálogo existente)
INSERT INTO "scoring_dimensions" ("code","label","description","is_active","sort_order","created_at","updated_at") VALUES
  ('incomeStability','Estabilidad del ingreso','Recurrencia y varianza del ingreso detectado en los extractos: meses con ingreso, coeficiente de variación y antigüedad laboral.',true,10,NOW(),NOW()),
  ('indebtedness','Endeudamiento','Carga financiera real: cuotas detectadas en extractos y nómina frente al ingreso verificado (DTI actual y proyectado con la nueva cuota).',true,11,NOW(),NOW()),
  ('financialBehavior','Comportamiento financiero','Manejo de la cuenta: saldo promedio, días en negativo, retiros inmediatos tras el abono, apuestas y débitos rechazados.',true,12,NOW(),NOW()),
  ('docVeracity','Veracidad documental','Consistencia entre documentos: continuidad de saldos, nómina vs abonos del extracto, cuenta de depósito y señales de la extracción.',true,13,NOW(),NOW())
ON CONFLICT ("code") DO NOTHING;

-- 3) credit_studies: discriminador + declarados del estudio de capacidad --
ALTER TABLE "credit_studies" ADD COLUMN "study_type_id" INTEGER;

UPDATE "credit_studies" SET "study_type_id" =
  (SELECT "id" FROM "parameters" WHERE "type" = 'study_type' AND "code" = 'financialStatements')
WHERE "study_type_id" IS NULL;

ALTER TABLE "credit_studies" ALTER COLUMN "study_type_id" SET NOT NULL;

ALTER TABLE "credit_studies" ADD CONSTRAINT "credit_studies_study_type_id_fkey"
  FOREIGN KEY ("study_type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "credit_studies_company_id_study_type_id_idx"
  ON "credit_studies"("company_id", "study_type_id");

ALTER TABLE "credit_studies" ADD COLUMN "employment_type_id" INTEGER;
ALTER TABLE "credit_studies" ADD COLUMN "declared_employment_start_date" DATE;

ALTER TABLE "credit_studies" ADD CONSTRAINT "credit_studies_employment_type_id_fkey"
  FOREIGN KEY ("employment_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) scoring_configurations: eje de tipo de estudio ----------------------
ALTER TABLE "scoring_configurations" ADD COLUMN "study_type_id" INTEGER;

UPDATE "scoring_configurations" SET "study_type_id" =
  (SELECT "id" FROM "parameters" WHERE "type" = 'study_type' AND "code" = 'financialStatements')
WHERE "study_type_id" IS NULL;

ALTER TABLE "scoring_configurations" ALTER COLUMN "study_type_id" SET NOT NULL;

ALTER TABLE "scoring_configurations" ADD CONSTRAINT "scoring_configurations_study_type_id_fkey"
  FOREIGN KEY ("study_type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "scoring_configurations_company_id_person_type_id_is_active_idx";
CREATE INDEX "scoring_configs_company_person_study_active_idx"
  ON "scoring_configurations"("company_id", "person_type_id", "study_type_id", "is_active");

-- 5) study_documents: PDFs aportados + extracción ------------------------
CREATE TABLE "study_documents" (
  "id" UUID NOT NULL,
  "credit_study_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "document_type_id" INTEGER NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "file_size_bytes" INTEGER NOT NULL,
  "storage_path" VARCHAR(500) NOT NULL,
  "extraction_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "extraction_error" TEXT,
  "ai_analysis_id" UUID,
  "extracted_data" JSONB,
  "summary" JSONB,
  "extraction_flags" JSONB,
  "validation_results" JSONB,
  "period_from" DATE,
  "period_to" DATE,
  "account_last4" VARCHAR(4),
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "study_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "study_documents_credit_study_id_idx" ON "study_documents"("credit_study_id");
CREATE INDEX "study_documents_company_id_created_at_idx" ON "study_documents"("company_id", "created_at");

ALTER TABLE "study_documents" ADD CONSTRAINT "study_documents_credit_study_id_fkey"
  FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "study_documents" ADD CONSTRAINT "study_documents_document_type_id_fkey"
  FOREIGN KEY ("document_type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "study_documents" ADD CONSTRAINT "study_documents_ai_analysis_id_fkey"
  FOREIGN KEY ("ai_analysis_id") REFERENCES "ai_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6) payment_capacity_analyses: indicadores calculados (1:1 con el estudio)
CREATE TABLE "payment_capacity_analyses" (
  "id" UUID NOT NULL,
  "credit_study_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "verified_monthly_income" DOUBLE PRECISION,
  "payroll_net_income" DOUBLE PRECISION,
  "bank_statement_income" DOUBLE PRECISION,
  "income_verification_index" DOUBLE PRECISION,
  "income_cv" DOUBLE PRECISION,
  "months_with_income" INTEGER,
  "window_months" INTEGER,
  "covered_months" INTEGER,
  "pays_own_social_security" BOOLEAN NOT NULL DEFAULT false,
  "verified_hire_date" DATE,
  "recurring_fixed_expenses" DOUBLE PRECISION,
  "existing_debt_payments" DOUBLE PRECISION,
  "available_income" DOUBLE PRECISION,
  "max_suggested_installment" DOUBLE PRECISION,
  "payroll_loan_capacity" DOUBLE PRECISION,
  "current_dti" DOUBLE PRECISION,
  "projected_dti" DOUBLE PRECISION,
  "behavior" JSONB,
  "monthly_income_series" JSONB,
  "detected_obligations" JSONB,
  "cross_validations" JSONB,
  "reliability_flags" JSONB,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_capacity_analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_capacity_analyses_credit_study_id_key"
  ON "payment_capacity_analyses"("credit_study_id");
CREATE INDEX "payment_capacity_analyses_company_id_created_at_idx"
  ON "payment_capacity_analyses"("company_id", "created_at");

ALTER TABLE "payment_capacity_analyses" ADD CONSTRAINT "payment_capacity_analyses_credit_study_id_fkey"
  FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
