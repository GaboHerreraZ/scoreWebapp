-- AlterTable: add per-company limit overrides to support add-on packages
ALTER TABLE "company_subscriptions"
  ADD COLUMN "max_users_override" INTEGER,
  ADD COLUMN "max_customers_override" INTEGER,
  ADD COLUMN "max_studies_per_month_override" INTEGER,
  ADD COLUMN "max_ai_analysis_per_month_override" INTEGER,
  ADD COLUMN "max_pdf_extractions_per_month_override" INTEGER;
