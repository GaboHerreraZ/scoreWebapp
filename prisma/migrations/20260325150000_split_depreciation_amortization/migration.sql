-- AlterTable: split depreciation_amortization into depreciation and amortization
ALTER TABLE "credit_studies" ADD COLUMN "depreciation" DOUBLE PRECISION;
ALTER TABLE "credit_studies" ADD COLUMN "amortization" DOUBLE PRECISION;
ALTER TABLE "credit_studies" DROP COLUMN "depreciation_amortization";
