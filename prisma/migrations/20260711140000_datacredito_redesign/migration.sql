-- Rediseño DataCrédito Experian (MiDecisor) + estados financieros a 3 tablas.
--
-- Reúne todos los cambios de schema del rediseño:
--   * Customer se repurposa: nace de la consulta al bureau. Se quitan campos de
--     alta manual (referencias comerciales, representante legal, antigüedad,
--     observaciones) y se añaden identidad/demografía PN (nombres, nacimiento,
--     género…), verificationDigit (PJ), bureauProfile (JSONB dominio PJ),
--     lastConsultedAt/bureauCreated. Nuevo @@unique(company_id, identification_number).
--   * CreditStudy se aligera: se le quitan ~40 cifras crudas + indicadores +
--     reliabilityFlags (ahora viven en las tablas de EEFF). Conserva solicitud
--     (requestedTerm/CreditLine) + resultado/viabilidad.
--   * EEFF a 3 tablas: financial_statement_periods (el HECHO: cifras crudas de un
--     año), financial_analyses (el CÁLCULO: indicadores de un PAR de años +
--     reliabilityFlags), credit_study_financial_analyses (join N:M: el estudio
--     congela qué análisis usó).
--   * Archivo crudo + dominio del bureau: credit_bureau_consultations (rawResponse
--     append-only) + customer_risk_snapshots (dominio de riesgo, 1:1 con consulta).
--
-- NOTA: se OMITE a propósito el `DROP TABLE _data_migrations` que sugería el diff
-- automático — esa tabla es del sistema custom de data-migrations
-- (scripts/apply-data-migrations.js), NO la gestiona Prisma. Ver CLAUDE.md.

-- DropForeignKey
ALTER TABLE "credit_studies" DROP CONSTRAINT "credit_studies_income_statement_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_legal_rep_identification_type_id_fkey";

-- AlterTable: CreditStudy pierde cifras crudas + indicadores + reliability_flags
ALTER TABLE "credit_studies" DROP COLUMN "accounts_payable_turnover",
DROP COLUMN "accounts_receivable_1",
DROP COLUMN "accounts_receivable_2",
DROP COLUMN "accounts_receivable_turnover",
DROP COLUMN "adjusted_ebitda",
DROP COLUMN "administrative_expenses",
DROP COLUMN "amortization",
DROP COLUMN "annual_payment_capacity",
DROP COLUMN "balance_sheet_date",
DROP COLUMN "cash_and_equivalents",
DROP COLUMN "cost_of_sales",
DROP COLUMN "current_debt_service",
DROP COLUMN "depreciation",
DROP COLUMN "ebitda",
DROP COLUMN "equity",
DROP COLUMN "financial_expenses",
DROP COLUMN "fixed_assets_property",
DROP COLUMN "gross_profit",
DROP COLUMN "income_statement_id",
DROP COLUMN "inventories_1",
DROP COLUMN "inventories_2",
DROP COLUMN "inventory_turnover",
DROP COLUMN "long_term_financial_liabilities",
DROP COLUMN "monthly_payment_capacity",
DROP COLUMN "net_income",
DROP COLUMN "ordinary_activity_revenue",
DROP COLUMN "payment_time_suppliers",
DROP COLUMN "reliability_flags",
DROP COLUMN "retained_earnings",
DROP COLUMN "selling_expenses",
DROP COLUMN "short_term_financial_liabilities",
DROP COLUMN "stability_factor",
DROP COLUMN "suppliers_1",
DROP COLUMN "suppliers_2",
DROP COLUMN "suppliers_turnover",
DROP COLUMN "taxes",
DROP COLUMN "total_assets",
DROP COLUMN "total_current_assets",
DROP COLUMN "total_current_liabilities",
DROP COLUMN "total_liabilities",
DROP COLUMN "total_non_current_assets",
DROP COLUMN "total_non_current_liabilities";

-- AlterTable: Customer se repurposa (nace de la consulta al bureau)
ALTER TABLE "customers" DROP COLUMN "commercial_ref1_contact",
DROP COLUMN "commercial_ref1_name",
DROP COLUMN "commercial_ref1_phone",
DROP COLUMN "commercial_ref2_contact",
DROP COLUMN "commercial_ref2_name",
DROP COLUMN "commercial_ref2_phone",
DROP COLUMN "legal_rep_email",
DROP COLUMN "legal_rep_id",
DROP COLUMN "legal_rep_identification_type_id",
DROP COLUMN "legal_rep_name",
DROP COLUMN "legal_rep_phone",
DROP COLUMN "observations",
DROP COLUMN "secondary_phone",
DROP COLUMN "seniority",
ADD COLUMN     "age_range" VARCHAR(10),
ADD COLUMN     "birth_city" VARCHAR(150),
ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "bureau_created" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bureau_profile" JSONB,
ADD COLUMN     "document_status" VARCHAR(50),
ADD COLUMN     "first_last_name" VARCHAR(150),
ADD COLUMN     "first_name" VARCHAR(150),
ADD COLUMN     "gender" VARCHAR(5),
ADD COLUMN     "last_consulted_at" TIMESTAMP(3),
ADD COLUMN     "second_last_name" VARCHAR(150),
ADD COLUMN     "second_name" VARCHAR(150),
ADD COLUMN     "verification_digit" VARCHAR(2);

-- CreateTable: financial_statement_periods (el HECHO — cifras crudas de UN año)
CREATE TABLE "financial_statement_periods" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "income_statement_id" INTEGER,
    "balance_sheet_date" DATE,
    "consultation_id" UUID,
    "cash_and_equivalents" DOUBLE PRECISION,
    "accounts_receivable" DOUBLE PRECISION,
    "inventories" DOUBLE PRECISION,
    "total_current_assets" DOUBLE PRECISION,
    "fixed_assets_property" DOUBLE PRECISION,
    "total_non_current_assets" DOUBLE PRECISION,
    "total_assets" DOUBLE PRECISION,
    "short_term_financial_liabilities" DOUBLE PRECISION,
    "suppliers" DOUBLE PRECISION,
    "total_current_liabilities" DOUBLE PRECISION,
    "long_term_financial_liabilities" DOUBLE PRECISION,
    "total_non_current_liabilities" DOUBLE PRECISION,
    "total_liabilities" DOUBLE PRECISION,
    "retained_earnings" DOUBLE PRECISION,
    "equity" DOUBLE PRECISION,
    "ordinary_activity_revenue" DOUBLE PRECISION,
    "cost_of_sales" DOUBLE PRECISION,
    "gross_profit" DOUBLE PRECISION,
    "administrative_expenses" DOUBLE PRECISION,
    "selling_expenses" DOUBLE PRECISION,
    "depreciation" DOUBLE PRECISION,
    "amortization" DOUBLE PRECISION,
    "financial_expenses" DOUBLE PRECISION,
    "taxes" DOUBLE PRECISION,
    "net_income" DOUBLE PRECISION,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_statement_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable: financial_analyses (el CÁLCULO — indicadores de un PAR de años)
CREATE TABLE "financial_analyses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "current_period_id" UUID NOT NULL,
    "prior_period_id" UUID,
    "reliability_flags" JSONB,
    "stability_factor" DOUBLE PRECISION,
    "ebitda" DOUBLE PRECISION,
    "adjusted_ebitda" DOUBLE PRECISION,
    "current_debt_service" DOUBLE PRECISION,
    "annual_payment_capacity" DOUBLE PRECISION,
    "monthly_payment_capacity" DOUBLE PRECISION,
    "accounts_receivable_turnover" DOUBLE PRECISION,
    "inventory_turnover" DOUBLE PRECISION,
    "suppliers_turnover" DOUBLE PRECISION,
    "payment_time_suppliers" DOUBLE PRECISION,
    "accounts_payable_turnover" DOUBLE PRECISION,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: credit_study_financial_analyses (join N:M — congelación EEFF↔estudio)
CREATE TABLE "credit_study_financial_analyses" (
    "id" UUID NOT NULL,
    "credit_study_id" UUID NOT NULL,
    "financial_analysis_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_study_financial_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: credit_bureau_consultations (archivo crudo — rawResponse append-only)
CREATE TABLE "credit_bureau_consultations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "provider" VARCHAR(30) NOT NULL DEFAULT 'experian',
    "person_type" VARCHAR(5) NOT NULL,
    "consulta_at" TIMESTAMP(3) NOT NULL,
    "tipo_id_digitado" VARCHAR(10) NOT NULL,
    "numero_id_digitado" VARCHAR(50) NOT NULL,
    "tx_code" VARCHAR(5),
    "codigos_respuesta" JSONB,
    "http_status" INTEGER NOT NULL,
    "raw_response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_bureau_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: customer_risk_snapshots (dominio de riesgo — 1:1 con consulta)
CREATE TABLE "customer_risk_snapshots" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "score" INTEGER,
    "viabilidad" VARCHAR(20),
    "rating_recaudos" VARCHAR(5),
    "nivel_riesgo" VARCHAR(20),
    "rating_sectorial" VARCHAR(20),
    "monto_sugerido" DOUBLE PRECISION,
    "saldo_actual" DOUBLE PRECISION,
    "porcentaje_deuda" DOUBLE PRECISION,
    "saldo_mora" DOUBLE PRECISION,
    "has_alertas" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_risk_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_statement_periods_customer_id_fiscal_year_idx" ON "financial_statement_periods"("customer_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "financial_statement_periods_company_id_created_at_idx" ON "financial_statement_periods"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "financial_analyses_customer_id_created_at_idx" ON "financial_analyses"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "financial_analyses_company_id_created_at_idx" ON "financial_analyses"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_study_financial_analyses_financial_analysis_id_idx" ON "credit_study_financial_analyses"("financial_analysis_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_study_financial_analyses_credit_study_id_financial_a_key" ON "credit_study_financial_analyses"("credit_study_id", "financial_analysis_id");

-- CreateIndex
CREATE INDEX "credit_bureau_consultations_customer_id_consulta_at_idx" ON "credit_bureau_consultations"("customer_id", "consulta_at");

-- CreateIndex
CREATE INDEX "credit_bureau_consultations_company_id_created_at_idx" ON "credit_bureau_consultations"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_risk_snapshots_consultation_id_key" ON "customer_risk_snapshots"("consultation_id");

-- CreateIndex
CREATE INDEX "customer_risk_snapshots_customer_id_created_at_idx" ON "customer_risk_snapshots"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_identification_number_key" ON "customers"("company_id", "identification_number");

-- AddForeignKey
ALTER TABLE "financial_statement_periods" ADD CONSTRAINT "financial_statement_periods_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_periods" ADD CONSTRAINT "financial_statement_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_periods" ADD CONSTRAINT "financial_statement_periods_income_statement_id_fkey" FOREIGN KEY ("income_statement_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_periods" ADD CONSTRAINT "financial_statement_periods_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "credit_bureau_consultations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_periods" ADD CONSTRAINT "financial_statement_periods_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_analyses" ADD CONSTRAINT "financial_analyses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_analyses" ADD CONSTRAINT "financial_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_analyses" ADD CONSTRAINT "financial_analyses_current_period_id_fkey" FOREIGN KEY ("current_period_id") REFERENCES "financial_statement_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_analyses" ADD CONSTRAINT "financial_analyses_prior_period_id_fkey" FOREIGN KEY ("prior_period_id") REFERENCES "financial_statement_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_analyses" ADD CONSTRAINT "financial_analyses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_study_financial_analyses" ADD CONSTRAINT "credit_study_financial_analyses_credit_study_id_fkey" FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_study_financial_analyses" ADD CONSTRAINT "credit_study_financial_analyses_financial_analysis_id_fkey" FOREIGN KEY ("financial_analysis_id") REFERENCES "financial_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bureau_consultations" ADD CONSTRAINT "credit_bureau_consultations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bureau_consultations" ADD CONSTRAINT "credit_bureau_consultations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bureau_consultations" ADD CONSTRAINT "credit_bureau_consultations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_risk_snapshots" ADD CONSTRAINT "customer_risk_snapshots_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "credit_bureau_consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_risk_snapshots" ADD CONSTRAINT "customer_risk_snapshots_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
