-- Catálogos fiscales de la DIAN que exige la factura electrónica: régimen frente
-- al IVA y responsabilidades fiscales del adquirente.
--
-- El `code` ES el código de la DIAN, no uno propio. Es un catálogo ajeno y
-- cerrado: inventar códigos internos solo para traducirlos después no aporta
-- nada y agrega un punto donde equivocarse. (Distinto de 'identification_type',
-- que ya existía como concepto del dominio antes de facturar y por eso conserva
-- sus codes propios con un mapa a DIAN en dian.catalogs.ts.)
--
-- Fuente: catálogos del proveedor de facturación
--   https://docs.aliaddo.com/tipos-de-regimen-2171101m0
--   https://docs.aliaddo.com/responsabilidades-fiscales-2171096m0
--
-- UPSERT sobre (type, code): idempotente, seguro de re-ejecutar en staging y
-- prod. El runner envuelve el archivo en una transacción, así que no va BEGIN.

-- ── Régimen frente al IVA ───────────────────────────────────────────────────
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at") VALUES
  ('tax_regime', '48', 'Responsable de IVA',    'Declara y cobra IVA',                    true, 1, NOW(), NOW()),
  ('tax_regime', '49', 'No responsable de IVA', 'No cobra IVA (antiguo régimen simplificado)', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO UPDATE
SET "label" = EXCLUDED."label",
    "description" = EXCLUDED."description",
    "is_active" = EXCLUDED."is_active",
    "sort_order" = EXCLUDED."sort_order",
    "updated_at" = NOW();

-- ── Responsabilidades fiscales ──────────────────────────────────────────────
-- R-99-PN va de primero: es el caso más común (la mayoría de adquirentes no
-- tiene ninguna responsabilidad especial) y conviene que encabece el selector.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at") VALUES
  ('fiscal_responsibility', 'R-99-PN', 'No aplica - Otros',           'Sin responsabilidades especiales', true, 1, NOW(), NOW()),
  ('fiscal_responsibility', 'O-13',    'Gran contribuyente',          NULL, true, 2, NOW(), NOW()),
  ('fiscal_responsibility', 'O-15',    'Autorretenedor',              NULL, true, 3, NOW(), NOW()),
  ('fiscal_responsibility', 'O-23',    'Agente de retención IVA',     NULL, true, 4, NOW(), NOW()),
  ('fiscal_responsibility', 'O-47',    'Régimen simple de tributación', NULL, true, 5, NOW(), NOW())
ON CONFLICT ("type", "code") DO UPDATE
SET "label" = EXCLUDED."label",
    "description" = EXCLUDED."description",
    "is_active" = EXCLUDED."is_active",
    "sort_order" = EXCLUDED."sort_order",
    "updated_at" = NOW();
