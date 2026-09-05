-- Feature flags: kill switches administrados desde el portal admin.
-- Seed en enabled=false: dark launch (se enciende desde el portal).
CREATE TABLE "feature_flags" (
  "code" VARCHAR(60) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "description" VARCHAR(255),
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "feature_flags_updated_by_fkey" FOREIGN KEY ("updated_by")
    REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "feature_flags" ("code","enabled","description","created_at","updated_at") VALUES
  ('paymentCapacity', false, 'Estudio de capacidad de pago (persona natural sin EEFF)', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
