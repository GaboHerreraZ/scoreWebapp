-- Move epaycoCustomerId from company_subscriptions to companies.
-- A company has a single ePayco customer; subscriptions reuse it across plan changes.

-- 1. Add column to companies (nullable to allow backfill before any constraint).
ALTER TABLE "companies" ADD COLUMN "epayco_customer_id" VARCHAR(100);

-- 2. Backfill: pick the most recently created non-null epaycoCustomerId per company.
UPDATE "companies" c
SET "epayco_customer_id" = sub."epayco_customer_id"
FROM (
  SELECT DISTINCT ON ("company_id")
    "company_id",
    "epayco_customer_id"
  FROM "company_subscriptions"
  WHERE "epayco_customer_id" IS NOT NULL
  ORDER BY "company_id", "created_at" DESC
) sub
WHERE c."id" = sub."company_id";

-- 3. Drop the column from company_subscriptions.
ALTER TABLE "company_subscriptions" DROP COLUMN "epayco_customer_id";
