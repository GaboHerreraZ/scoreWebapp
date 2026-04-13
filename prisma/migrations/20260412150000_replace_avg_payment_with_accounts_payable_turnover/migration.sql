-- AlterTable: drop old column and add new one
ALTER TABLE "credit_studies" DROP COLUMN "average_payment_time";
ALTER TABLE "credit_studies" ADD COLUMN "accounts_payable_turnover" DOUBLE PRECISION;
