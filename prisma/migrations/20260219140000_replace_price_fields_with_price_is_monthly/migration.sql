-- AlterTable: Replace monthlyPrice/annualPrice with price + isMonthly

-- Step 1: Add new columns
ALTER TABLE "subscriptions" ADD COLUMN "price" DOUBLE PRECISION;
ALTER TABLE "subscriptions" ADD COLUMN "is_monthly" BOOLEAN NOT NULL DEFAULT true;

-- Step 2: Migrate existing data (monthly_price takes priority)
UPDATE "subscriptions"
SET "price" = COALESCE("monthly_price", "annual_price"),
    "is_monthly" = CASE
      WHEN "monthly_price" IS NOT NULL THEN true
      ELSE false
    END;

-- Step 3: Drop old columns
ALTER TABLE "subscriptions" DROP COLUMN "monthly_price";
ALTER TABLE "subscriptions" DROP COLUMN "annual_price";
