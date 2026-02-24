-- 1. Insert parameter records for dashboard levels (if not exist)
INSERT INTO "parameters" ("type", "code", "label", "is_active", "sort_order", "created_at", "updated_at")
SELECT 'DASHBOARD_LEVEL', 'basic', 'Básico', true, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "parameters" WHERE "type" = 'DASHBOARD_LEVEL' AND "code" = 'basic');

INSERT INTO "parameters" ("type", "code", "label", "is_active", "sort_order", "created_at", "updated_at")
SELECT 'DASHBOARD_LEVEL', 'advanced', 'Avanzado', true, 2, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "parameters" WHERE "type" = 'DASHBOARD_LEVEL' AND "code" = 'advanced');

-- 2. Insert parameter records for support levels (if not exist)
INSERT INTO "parameters" ("type", "code", "label", "is_active", "sort_order", "created_at", "updated_at")
SELECT 'SUPPORT_LEVEL', 'email', 'Email', true, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "parameters" WHERE "type" = 'SUPPORT_LEVEL' AND "code" = 'email');

INSERT INTO "parameters" ("type", "code", "label", "is_active", "sort_order", "created_at", "updated_at")
SELECT 'SUPPORT_LEVEL', 'priority_email', 'Email prioritario', true, 2, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "parameters" WHERE "type" = 'SUPPORT_LEVEL' AND "code" = 'priority_email');

-- 3. Add new columns as nullable (IF NOT EXISTS for idempotency)
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "dashboard_level_id" INTEGER;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "support_level_id" INTEGER;

-- 4. Populate new columns from existing string values (only if old columns exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'dashboard_level') THEN
    UPDATE "subscriptions" s
    SET "dashboard_level_id" = p."id"
    FROM "parameters" p
    WHERE p."type" = 'DASHBOARD_LEVEL' AND p."code" = s."dashboard_level"
      AND s."dashboard_level_id" IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'support_level') THEN
    UPDATE "subscriptions" s
    SET "support_level_id" = p."id"
    FROM "parameters" p
    WHERE p."type" = 'SUPPORT_LEVEL' AND p."code" = s."support_level"
      AND s."support_level_id" IS NULL;
  END IF;
END $$;

-- 5. Fallback: set any remaining NULLs to the default parameter
UPDATE "subscriptions"
SET "dashboard_level_id" = (SELECT "id" FROM "parameters" WHERE "type" = 'DASHBOARD_LEVEL' AND "code" = 'basic' LIMIT 1)
WHERE "dashboard_level_id" IS NULL;

UPDATE "subscriptions"
SET "support_level_id" = (SELECT "id" FROM "parameters" WHERE "type" = 'SUPPORT_LEVEL' AND "code" = 'email' LIMIT 1)
WHERE "support_level_id" IS NULL;

-- 6. Make columns NOT NULL
ALTER TABLE "subscriptions" ALTER COLUMN "dashboard_level_id" SET NOT NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "support_level_id" SET NOT NULL;

-- 7. Drop old string columns (IF EXISTS for idempotency)
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "dashboard_level";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "support_level";

-- 8. Add foreign key constraints (drop first if exist for idempotency)
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_dashboard_level_id_fkey";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_dashboard_level_id_fkey" FOREIGN KEY ("dashboard_level_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_support_level_id_fkey";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_support_level_id_fkey" FOREIGN KEY ("support_level_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
