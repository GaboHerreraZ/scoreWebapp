-- Add token and expires_at columns with defaults for existing rows
ALTER TABLE "invitations" ADD COLUMN "token" VARCHAR(64);
ALTER TABLE "invitations" ADD COLUMN "expires_at" TIMESTAMP(3);

-- Fill existing rows with generated values
UPDATE "invitations" SET "token" = gen_random_uuid()::text, "expires_at" = NOW() + INTERVAL '7 days' WHERE "token" IS NULL;

-- Now make columns required and add unique constraint
ALTER TABLE "invitations" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "invitations" ALTER COLUMN "expires_at" SET NOT NULL;
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");
