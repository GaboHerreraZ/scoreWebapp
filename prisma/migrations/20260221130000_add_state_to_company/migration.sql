-- AlterTable
ALTER TABLE "companies" ADD COLUMN "state" VARCHAR(150);

-- Backfill existing rows with empty string
UPDATE "companies" SET "state" = '' WHERE "state" IS NULL;

-- Make column NOT NULL
ALTER TABLE "companies" ALTER COLUMN "state" SET NOT NULL;
