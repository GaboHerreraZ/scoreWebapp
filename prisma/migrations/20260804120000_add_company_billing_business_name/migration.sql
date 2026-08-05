-- Razón social del responsable de facturación cuando es persona jurídica (NIT).
-- En ese caso el front no envía billing_name / billing_last_name.
ALTER TABLE "companies" ADD COLUMN "billing_business_name" VARCHAR(255);
