-- Seed: credit study status for pending signature
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('creditStatus', 'pendienteFirma', 'Pendiente Firma', NULL, true, 0, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
