-- AlterTable
ALTER TABLE "credit_studies"
  ADD COLUMN IF NOT EXISTS "recommended_term" INTEGER,
  ADD COLUMN IF NOT EXISTS "recommended_credit_line" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "viability_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "viability_status" TEXT,
  ADD COLUMN IF NOT EXISTS "viability_conditions" JSONB;
