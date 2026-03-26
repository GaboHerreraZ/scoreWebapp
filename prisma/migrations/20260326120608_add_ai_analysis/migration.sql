-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "max_ai_analysis_per_month" INTEGER;

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "credit_study_id" UUID NOT NULL,
    "performed_by" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "result" TEXT,
    "model" VARCHAR(100) NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost_usd" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_credit_study_id_fkey" FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
