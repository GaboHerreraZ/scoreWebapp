-- Consulta de riesgo crediticio (bureauCheck): tercer tipo de estudio con flujo
-- backend propio (src/bureau-check/) y BOLSAS SEPARADAS por producto: precios,
-- ofertas y bolsas ganan product_type_id (creditStudy | bureauCheck) para que
-- el producto barato no comparta pool ni precio con los estudios completos.
-- El entregable es dato transformado (análisis IA en formato propio), nunca el
-- reporte crudo de la central.

-- 1) Parámetros nuevos ---------------------------------------------------
INSERT INTO "parameters" ("type","code","label","description","is_active","sort_order","created_at","updated_at") VALUES
  ('study_type','bureauCheck','Consulta de riesgo crediticio','Servicio de consulta, verificación y análisis del perfil de riesgo en centrales (persona natural)',true,2,NOW(),NOW()),
  ('pack_product_type','creditStudy','Estudios de crédito','Bolsa que consumen los estudios completos (empresarial y capacidad de pago)',true,0,NOW(),NOW()),
  ('pack_product_type','bureauCheck','Consultas de riesgo','Bolsa que consumen las consultas de riesgo crediticio',true,1,NOW(),NOW()),
  ('ai_analysis_type','bureauCheckReview','Análisis de consulta de riesgo','Corrida IA que interpreta el snapshot de la central para la consulta de riesgo',true,0,NOW(),NOW())
ON CONFLICT ("type","code") DO NOTHING;

-- 2) Producto en precios, ofertas y bolsas (backfill a creditStudy) ------
ALTER TABLE "consultation_prices" ADD COLUMN "product_type_id" INTEGER;

UPDATE "consultation_prices" SET "product_type_id" =
  (SELECT "id" FROM "parameters" WHERE "type" = 'pack_product_type' AND "code" = 'creditStudy')
WHERE "product_type_id" IS NULL;

ALTER TABLE "consultation_prices" ALTER COLUMN "product_type_id" SET NOT NULL;

ALTER TABLE "consultation_prices" ADD CONSTRAINT "consultation_prices_product_type_id_fkey"
  FOREIGN KEY ("product_type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pack_offerings" ADD COLUMN "product_type_id" INTEGER;

UPDATE "pack_offerings" SET "product_type_id" =
  (SELECT "id" FROM "parameters" WHERE "type" = 'pack_product_type' AND "code" = 'creditStudy')
WHERE "product_type_id" IS NULL;

ALTER TABLE "pack_offerings" ALTER COLUMN "product_type_id" SET NOT NULL;

ALTER TABLE "pack_offerings" ADD CONSTRAINT "pack_offerings_product_type_id_fkey"
  FOREIGN KEY ("product_type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "pack_offerings_product_type_id_idx" ON "pack_offerings"("product_type_id");

ALTER TABLE "analysis_packs" ADD COLUMN "product_type_id" INTEGER;

UPDATE "analysis_packs" SET "product_type_id" =
  (SELECT "id" FROM "parameters" WHERE "type" = 'pack_product_type' AND "code" = 'creditStudy')
WHERE "product_type_id" IS NULL;

ALTER TABLE "analysis_packs" ALTER COLUMN "product_type_id" SET NOT NULL;

ALTER TABLE "analysis_packs" ADD CONSTRAINT "analysis_packs_product_type_id_fkey"
  FOREIGN KEY ("product_type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "analysis_packs_company_id_product_type_id_status_id_end_date_idx"
  ON "analysis_packs"("company_id", "product_type_id", "status_id", "end_date");

-- 3) Análisis de la consulta (el entregable, upsert por perform) ---------
CREATE TABLE "bureau_check_analyses" (
  "id" UUID NOT NULL,
  "credit_study_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "summary" TEXT,
  "risk_level" VARCHAR(10),
  "red_flags" JSONB,
  "positive_signals" JSONB,
  "sections" JSONB,
  "key_figures" JSONB,
  "amount_comparison" JSONB,
  "ai_analysis_id" UUID,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bureau_check_analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bureau_check_analyses_credit_study_id_key"
  ON "bureau_check_analyses"("credit_study_id");

CREATE INDEX "bureau_check_analyses_company_id_created_at_idx"
  ON "bureau_check_analyses"("company_id", "created_at");

ALTER TABLE "bureau_check_analyses" ADD CONSTRAINT "bureau_check_analyses_credit_study_id_fkey"
  FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Feature flag (nace apagado: dark launch) ----------------------------
INSERT INTO "feature_flags" ("code","enabled","description","created_at","updated_at") VALUES
  ('bureauCheck', false, 'Consulta de riesgo crediticio (creación de consultas y compra de sus bolsas)', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
