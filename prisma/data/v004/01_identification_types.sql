-- Normalize and extend the 'identification_type' parameter catalog.
--
-- Context:
--   * The app contract expects LOWERCASE codes: credit-bureau.service.ts looks up
--     the parameter with code.toLowerCase(), the consult DTO validates with
--     @IsIn(['cc','nit','ce','pas']) and the Experian mappers key on lowercase codes.
--   * PROD already stored lowercase codes; STAGING stored UPPERCASE (CC/CE/NIT/PA),
--     which is inconsistent with that contract. This script normalizes both to
--     lowercase so staging and prod match.
--   * The existing 'Pasaporte' code is renamed pa -> pas (see PARAM_CODE_TO_EXPERIAN_DOC).
--
-- Existing rows are UPDATEd (not deleted) to preserve FK references from
-- customers.identification_type_id / profiles.identification_type_id.
-- New rows are UPSERTed on (type, code) so this script is idempotent and safe to
-- re-run against either environment regardless of current casing.

BEGIN;

-- 1) Normalize existing rows by id (ids 104-107 are the seeded identification types).
--    Codes -> lowercase, labels aligned, sort_order 1..4.
UPDATE "parameters" SET "code" = 'cc',  "label" = 'Cédula de Ciudadanía',  "sort_order" = 1, "is_active" = true, "updated_at" = NOW() WHERE "id" = 104 AND "type" = 'identification_type';
UPDATE "parameters" SET "code" = 'nit', "label" = 'NIT',                    "sort_order" = 2, "is_active" = true, "updated_at" = NOW() WHERE "id" = 106 AND "type" = 'identification_type';
UPDATE "parameters" SET "code" = 'ce',  "label" = 'Cédula de Extranjería',  "sort_order" = 4, "is_active" = true, "updated_at" = NOW() WHERE "id" = 105 AND "type" = 'identification_type';
UPDATE "parameters" SET "code" = 'pas', "label" = 'Pasaporte',              "sort_order" = 5, "is_active" = true, "updated_at" = NOW() WHERE "id" = 107 AND "type" = 'identification_type';

-- 2) Insert the new identification types. UPSERT on the (type, code) unique key so
--    re-runs are no-ops and casing normalization above cannot cause a duplicate.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at") VALUES
  ('identification_type', 'pje', 'Persona jurídica del extranjero',                       NULL, true, 3, NOW(), NOW()),
  ('identification_type', 'ppt', 'Permiso por Protección Temporal / Carné Diplomático',   NULL, true, 6, NOW(), NOW()),
  ('identification_type', 'ti',  'Tarjeta de Identidad',                                  NULL, true, 7, NOW(), NOW()),
  ('identification_type', 'dni', 'Documento Nacional de Identidad',                       NULL, true, 8, NOW(), NOW()),
  ('identification_type', 'pep', 'Permiso Especial de Permanencia',                       NULL, true, 9, NOW(), NOW())
ON CONFLICT ("type", "code") DO UPDATE
  SET "label" = EXCLUDED."label",
      "description" = EXCLUDED."description",
      "is_active" = EXCLUDED."is_active",
      "sort_order" = EXCLUDED."sort_order",
      "updated_at" = NOW();

COMMIT;
