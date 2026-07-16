-- ─── Catálogo de dimensiones de scoring + pesos normalizados ────────────────
-- Reemplaza las 7 columnas weight_* de scoring_configurations por:
--   1. scoring_dimensions: catálogo global (administrado por Creditia, sin
--      borrado físico: solo is_active).
--   2. scoring_configuration_weights: una fila por dimensión HABILITADA en cada
--      versión de configuración. Sin fila = deshabilitada (no participa).
-- Incluye seed de las 7 dimensiones actuales y backfill de las configs
-- existentes (solo pesos > 0: en PN veracity=0 pasa a "no habilitada").

-- 1. Catálogo de dimensiones
CREATE TABLE "scoring_dimensions" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_dimensions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scoring_dimensions_code_key" ON "scoring_dimensions"("code");

-- 2. Pesos por configuración (una fila por dimensión habilitada)
CREATE TABLE "scoring_configuration_weights" (
    "id" UUID NOT NULL,
    "config_id" UUID NOT NULL,
    "dimension_id" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "scoring_configuration_weights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scoring_configuration_weights_config_id_dimension_id_key"
    ON "scoring_configuration_weights"("config_id", "dimension_id");

ALTER TABLE "scoring_configuration_weights"
    ADD CONSTRAINT "scoring_configuration_weights_config_id_fkey"
    FOREIGN KEY ("config_id") REFERENCES "scoring_configurations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scoring_configuration_weights"
    ADD CONSTRAINT "scoring_configuration_weights_dimension_id_fkey"
    FOREIGN KEY ("dimension_id") REFERENCES "scoring_dimensions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Seed: las 7 dimensiones que veníamos manejando (created_at/updated_at
--    explícitos: los defaults de Prisma son client-side, no de SQL).
INSERT INTO "scoring_dimensions" ("code", "label", "description", "is_active", "sort_order", "created_at", "updated_at") VALUES
  ('financialHealth', 'Salud financiera',
   'Evalúa la solidez financiera general del cliente a partir de sus estados financieros: liquidez, apalancamiento, rentabilidad y eficiencia (modelo Z-Altman). Mide la probabilidad de que el negocio se mantenga operando de forma sana.',
   true, 1, NOW(), NOW()),
  ('paymentCapacity', 'Capacidad de pago',
   'Compara el flujo de caja que el cliente puede destinar al pago de deuda (EBITDA ajustado menos servicio de deuda actual) contra la cuota mensual estimada del crédito solicitado. Mide si el cliente puede pagar la obligación sin ahogarse.',
   true, 2, NOW(), NOW()),
  ('termCoherence', 'Coherencia de plazos',
   'Contrasta el plazo de pago solicitado con la rotación de cartera del cliente (los días que tarda en cobrarle a sus propios clientes). Detecta si el plazo pedido le genera tensión de liquidez: pagar antes de cobrar exige capital de trabajo propio.',
   true, 3, NOW(), NOW()),
  ('creditLineAdequacy', 'Adecuación del cupo',
   'Verifica que el cupo solicitado respete dos techos: el máximo pagable según la capacidad de pago del cliente en el plazo pedido, y el monto que avala la central de riesgo. Un cupo por encima de cualquiera de los dos se considera inadecuado.',
   true, 4, NOW(), NOW()),
  ('capitalExposure', 'Exposición del capital',
   'Mide la eficiencia del capital prestado frente al ciclo de conversión de caja del cliente (cartera + inventarios − proveedores): cuánto dinero queda inmovilizado y por cuánto tiempo en relación con lo saludable para su operación.',
   true, 5, NOW(), NOW()),
  ('veracity', 'Veracidad',
   'Contrasta los estados financieros aportados por el cliente (PDF) contra los reportados en la central de riesgo (DataCrédito) para el mismo año fiscal. Detecta cifras infladas o maquilladas. Solo aplica a persona jurídica: la central no publica estados financieros de personas naturales.',
   true, 6, NOW(), NOW()),
  ('centralRisk', 'Riesgo de la central',
   'Traduce la información de la central de riesgo (puntaje crediticio, nivel de riesgo, comportamiento de pago histórico, endeudamiento y rating del sector) en una medida del riesgo crediticio externo del cliente. Es la señal de mercado más objetiva disponible.',
   true, 7, NOW(), NOW());

-- 4. Backfill: cada configuración existente conserva sus pesos como filas.
--    Solo pesos > 0: veracity=0 en PN pasa a "dimensión no habilitada", que es
--    la nueva semántica equivalente.
INSERT INTO "scoring_configuration_weights" ("id", "config_id", "dimension_id", "weight")
SELECT gen_random_uuid(), sc."id", d."id",
  CASE d."code"
    WHEN 'financialHealth'    THEN sc."weight_financial_health"
    WHEN 'paymentCapacity'    THEN sc."weight_payment_capacity"
    WHEN 'termCoherence'      THEN sc."weight_term_coherence"
    WHEN 'creditLineAdequacy' THEN sc."weight_credit_line_adequacy"
    WHEN 'capitalExposure'    THEN sc."weight_capital_exposure"
    WHEN 'veracity'           THEN sc."weight_veracity"
    WHEN 'centralRisk'        THEN sc."weight_central_risk"
  END
FROM "scoring_configurations" sc
CROSS JOIN "scoring_dimensions" d
WHERE
  CASE d."code"
    WHEN 'financialHealth'    THEN sc."weight_financial_health"
    WHEN 'paymentCapacity'    THEN sc."weight_payment_capacity"
    WHEN 'termCoherence'      THEN sc."weight_term_coherence"
    WHEN 'creditLineAdequacy' THEN sc."weight_credit_line_adequacy"
    WHEN 'capitalExposure'    THEN sc."weight_capital_exposure"
    WHEN 'veracity'           THEN sc."weight_veracity"
    WHEN 'centralRisk'        THEN sc."weight_central_risk"
  END > 0;

-- 5. Eliminar las columnas de pesos (ya respaldadas en el paso 4)
ALTER TABLE "scoring_configurations"
    DROP COLUMN "weight_financial_health",
    DROP COLUMN "weight_payment_capacity",
    DROP COLUMN "weight_term_coherence",
    DROP COLUMN "weight_credit_line_adequacy",
    DROP COLUMN "weight_capital_exposure",
    DROP COLUMN "weight_veracity",
    DROP COLUMN "weight_central_risk";
