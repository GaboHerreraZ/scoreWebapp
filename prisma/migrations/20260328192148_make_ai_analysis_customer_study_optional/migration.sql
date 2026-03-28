-- DropForeignKey
ALTER TABLE "ai_analyses" DROP CONSTRAINT "ai_analyses_credit_study_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_analyses" DROP CONSTRAINT "ai_analyses_customer_id_fkey";

-- AlterTable
ALTER TABLE "ai_analyses" ALTER COLUMN "customer_id" DROP NOT NULL,
ALTER COLUMN "credit_study_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_credit_study_id_fkey" FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
