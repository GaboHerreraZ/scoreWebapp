-- ─── Fusión de "Adecuación del cupo" en "Capacidad de pago" ─────────────────
-- La Dim 4 (creditLineAdequacy) medía lo mismo que la Dim 2 (paymentCapacity)
-- desde el otro lado (cupo/máx-pagable = inverso de capacidad/cuota); lo único
-- distinto era el techo del montoSugerido de la central, que deja de ser techo
-- (pasa a señal/alerta: en el mercado real es muy conservador frente a los EEFF
-- del cliente). Se fusionan: el motor ya no soporta creditLineAdequacy.
--
--  1. Pesos: el peso de creditLineAdequacy se SUMA al de paymentCapacity en
--     cada configuración (los pesos siguen sumando 100). Defensivo: si una
--     config no tuviera fila de paymentCapacity (no debería: es obligatoria),
--     se crea con el peso trasladado.
--  2. Se eliminan las filas de peso de creditLineAdequacy.
--  3. El catálogo desactiva creditLineAdequacy (sin borrado físico) y actualiza
--     la descripción de paymentCapacity para reflejar el alcance fusionado.

-- 1a. Sumar el peso al paymentCapacity existente de la misma config.
UPDATE "scoring_configuration_weights" pc
SET "weight" = pc."weight" + cla."weight"
FROM "scoring_configuration_weights" cla
JOIN "scoring_dimensions" dc ON dc."id" = cla."dimension_id" AND dc."code" = 'creditLineAdequacy'
WHERE cla."config_id" = pc."config_id"
  AND pc."dimension_id" = (SELECT "id" FROM "scoring_dimensions" WHERE "code" = 'paymentCapacity');

-- 1b. Configs (anómalas) con creditLineAdequacy pero sin paymentCapacity:
--     trasladar el peso creando la fila.
INSERT INTO "scoring_configuration_weights" ("id", "config_id", "dimension_id", "weight")
SELECT gen_random_uuid(), cla."config_id",
       (SELECT "id" FROM "scoring_dimensions" WHERE "code" = 'paymentCapacity'),
       cla."weight"
FROM "scoring_configuration_weights" cla
JOIN "scoring_dimensions" dc ON dc."id" = cla."dimension_id" AND dc."code" = 'creditLineAdequacy'
WHERE NOT EXISTS (
  SELECT 1 FROM "scoring_configuration_weights" pc
  WHERE pc."config_id" = cla."config_id"
    AND pc."dimension_id" = (SELECT "id" FROM "scoring_dimensions" WHERE "code" = 'paymentCapacity')
);

-- 2. Eliminar las filas de peso de la dimensión fusionada.
DELETE FROM "scoring_configuration_weights"
WHERE "dimension_id" = (SELECT "id" FROM "scoring_dimensions" WHERE "code" = 'creditLineAdequacy');

-- 3a. Desactivar la dimensión en el catálogo (el motor ya no la soporta).
UPDATE "scoring_dimensions"
SET "is_active" = false,
    "description" = '[FUSIONADA en Capacidad de pago] ' || COALESCE("description", ''),
    "updated_at" = NOW()
WHERE "code" = 'creditLineAdequacy';

-- 3b. Descripción de la dimensión fusionada: capacidad de pago + adecuación
--     del cupo (el montoSugerido de la central es señal, no techo).
UPDATE "scoring_dimensions"
SET "description" = 'Compara el flujo de caja que el cliente puede destinar al pago de deuda (EBITDA ajustado menos servicio de deuda actual) contra la cuota mensual estimada del crédito solicitado, e integra la adecuación del cupo: verifica que el monto pedido quepa en el máximo pagable según los estados financieros para el plazo. El monto sugerido por la central de riesgo NO es techo: se contrasta como señal y genera alertas cuando el pedido lo supera por mucho.',
    "updated_at" = NOW()
WHERE "code" = 'paymentCapacity';
