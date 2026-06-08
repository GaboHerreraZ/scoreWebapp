-- Add reliability_flags to credit_studies.
-- Stores AI-detected red flags about the reliability/consistency of the
-- financial statements (computed during PDF extraction). Nullable JSON,
-- alongside viability_conditions.
ALTER TABLE "credit_studies" ADD COLUMN IF NOT EXISTS "reliability_flags" JSONB;
