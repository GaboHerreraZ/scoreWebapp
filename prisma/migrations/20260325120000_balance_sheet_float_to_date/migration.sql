-- AlterTable: change balance_sheet from DOUBLE PRECISION to TIMESTAMP(3)
-- First drop existing float data in the column, then alter the type
ALTER TABLE "credit_studies" ALTER COLUMN "balance_sheet" DROP DEFAULT;
ALTER TABLE "credit_studies" ALTER COLUMN "balance_sheet" TYPE TIMESTAMP(3) USING NULL;
