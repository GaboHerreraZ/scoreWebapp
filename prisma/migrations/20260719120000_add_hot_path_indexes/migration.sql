-- Índices para las rutas calientes detectadas en la auditoría de rendimiento:
-- credit_studies no tenía NINGÚN índice secundario (Postgres no indexa FKs
-- automáticamente) y el dashboard/listados hacían seq scan. Ver también
-- user_companies (el unique empieza por user_id y no cubre filtros por
-- company_id), customers (orden alfabético del listado) e invitations
-- (lookups por empresa+estado y por email). promo_codes_code_idx era
-- redundante: code ya tiene índice único.

-- DropIndex
DROP INDEX "promo_codes_code_idx";

-- CreateIndex
CREATE INDEX "user_companies_company_id_idx" ON "user_companies"("company_id");

-- CreateIndex
CREATE INDEX "customers_company_id_business_name_idx" ON "customers"("company_id", "business_name");

-- CreateIndex
CREATE INDEX "credit_studies_company_id_study_date_idx" ON "credit_studies"("company_id", "study_date");

-- CreateIndex
CREATE INDEX "credit_studies_company_id_status_id_idx" ON "credit_studies"("company_id", "status_id");

-- CreateIndex
CREATE INDEX "credit_studies_customer_id_idx" ON "credit_studies"("customer_id");

-- CreateIndex
CREATE INDEX "invitations_company_id_status_id_idx" ON "invitations"("company_id", "status_id");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");
