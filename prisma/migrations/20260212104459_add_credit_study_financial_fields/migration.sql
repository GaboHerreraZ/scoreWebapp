/*
  Warnings:

  - You are about to drop the column `approved_amount` on the `credit_studies` table. All the data in the column will be lost.
  - You are about to drop the column `interest_rate` on the `credit_studies` table. All the data in the column will be lost.
  - You are about to drop the column `requested_amount` on the `credit_studies` table. All the data in the column will be lost.
  - You are about to drop the column `term_months` on the `credit_studies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "credit_studies" DROP COLUMN "approved_amount",
DROP COLUMN "interest_rate",
DROP COLUMN "requested_amount",
DROP COLUMN "term_months",
ADD COLUMN     "accounts_receivable_1" DOUBLE PRECISION,
ADD COLUMN     "accounts_receivable_2" DOUBLE PRECISION,
ADD COLUMN     "accounts_receivable_turnover" DOUBLE PRECISION,
ADD COLUMN     "adjusted_ebitda" DOUBLE PRECISION,
ADD COLUMN     "administrative_expenses" DOUBLE PRECISION,
ADD COLUMN     "annual_payment_capacity" DOUBLE PRECISION,
ADD COLUMN     "average_payment_time" DOUBLE PRECISION,
ADD COLUMN     "balance_sheet" DOUBLE PRECISION,
ADD COLUMN     "cash_and_equivalents" DOUBLE PRECISION,
ADD COLUMN     "cost_of_sales" DOUBLE PRECISION,
ADD COLUMN     "current_debt_service" DOUBLE PRECISION,
ADD COLUMN     "depreciation_amortization" DOUBLE PRECISION,
ADD COLUMN     "ebitda" DOUBLE PRECISION,
ADD COLUMN     "equity" DOUBLE PRECISION,
ADD COLUMN     "financial_expenses" DOUBLE PRECISION,
ADD COLUMN     "fixed_assets_property" DOUBLE PRECISION,
ADD COLUMN     "gross_profit" DOUBLE PRECISION,
ADD COLUMN     "income_statement_id" INTEGER,
ADD COLUMN     "inventories_1" DOUBLE PRECISION,
ADD COLUMN     "inventories_2" DOUBLE PRECISION,
ADD COLUMN     "inventory_turnover" DOUBLE PRECISION,
ADD COLUMN     "long_term_financial_liabilities" DOUBLE PRECISION,
ADD COLUMN     "maximum_payment_time" DOUBLE PRECISION,
ADD COLUMN     "monthly_payment_capacity" DOUBLE PRECISION,
ADD COLUMN     "net_income" DOUBLE PRECISION,
ADD COLUMN     "ordinary_activity_revenue" DOUBLE PRECISION,
ADD COLUMN     "requested_monthly_credit_line" DOUBLE PRECISION,
ADD COLUMN     "requested_term" INTEGER,
ADD COLUMN     "retained_earnings" DOUBLE PRECISION,
ADD COLUMN     "selling_expenses" DOUBLE PRECISION,
ADD COLUMN     "short_term_financial_liabilities" DOUBLE PRECISION,
ADD COLUMN     "stability_factor" DOUBLE PRECISION,
ADD COLUMN     "suppliers_1" DOUBLE PRECISION,
ADD COLUMN     "suppliers_2" DOUBLE PRECISION,
ADD COLUMN     "suppliers_turnover" DOUBLE PRECISION,
ADD COLUMN     "taxes" DOUBLE PRECISION,
ADD COLUMN     "total_assets" DOUBLE PRECISION,
ADD COLUMN     "total_current_assets" DOUBLE PRECISION,
ADD COLUMN     "total_current_liabilities" DOUBLE PRECISION,
ADD COLUMN     "total_liabilities" DOUBLE PRECISION,
ADD COLUMN     "total_non_current_assets" DOUBLE PRECISION,
ADD COLUMN     "total_non_current_liabilities" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "credit_studies" ADD CONSTRAINT "credit_studies_income_statement_id_fkey" FOREIGN KEY ("income_statement_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
