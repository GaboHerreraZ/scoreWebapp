-- ─── Borrado físico de creditLineAdequacy del catálogo ──────────────────────
-- La migración anterior (merge_credit_line_adequacy) la dejó desactivada por la
-- regla general de "sin borrado físico" del catálogo. Decisión posterior: la
-- dimensión ya no existe en el motor ni tiene pesos que la referencien (se
-- fusionaron en paymentCapacity), y no hay estudios históricos que proteger
-- (BBDD limpia) → se elimina la fila para no arrastrar una entrada muerta.

-- Defensivo: cualquier peso residual que la referencie (no debería haber).
DELETE FROM "scoring_configuration_weights"
WHERE "dimension_id" = (SELECT "id" FROM "scoring_dimensions" WHERE "code" = 'creditLineAdequacy');

DELETE FROM "scoring_dimensions" WHERE "code" = 'creditLineAdequacy';
