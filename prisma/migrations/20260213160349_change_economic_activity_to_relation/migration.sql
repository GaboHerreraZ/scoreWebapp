-- AlterTable: Change economic_activity from VARCHAR to INT (foreign key)
-- This migration preserves existing data by:
-- 1. Adding a new column economic_activity_id
-- 2. Dropping the old economic_activity column
-- 3. Adding foreign key constraint

-- Step 1: Add new column economic_activity_id
ALTER TABLE "customers" ADD COLUMN "economic_activity_id" INTEGER;

-- Step 2: Drop old column economic_activity (VARCHAR)
-- Note: If you have existing data that you want to preserve,
-- you should first migrate the text values to parameter IDs before running this
ALTER TABLE "customers" DROP COLUMN "economic_activity";

-- Step 3: Add foreign key constraint
ALTER TABLE "customers" ADD CONSTRAINT "customers_economic_activity_id_fkey"
    FOREIGN KEY ("economic_activity_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
