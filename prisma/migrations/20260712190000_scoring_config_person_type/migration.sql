-- Config de scoring separada por tipo de persona. Una empresa pasa de tener UNA
-- config vigente a tener DOS: una para persona natural y otra para jurídica (PN y
-- PJ son perfiles de riesgo distintos). Se agrega person_type_id (FK a parameters
-- type='person_type': naturalPerson=9, legalEntity=10) y el versionado (is_active)
-- pasa a ser por (empresa, tipo).
--
-- Las configs existentes (creadas con el modelo de 1-config) se asignan a
-- legalEntity por defecto; sus pares PN se crean desde el front / onboarding. Se
-- verificó que NO hay estudios atados a config (scoring_configuration_id), así que
-- el reasignar tipo no afecta análisis previos.
--
-- NOTA: se OMITE el ruido del diff (DROP _data_migrations, invitations fkey,
-- platform_admins default). Ver CLAUDE.md.

-- AlterTable: agregar la columna como NULLABLE primero (hay filas existentes).
ALTER TABLE "scoring_configurations" ADD COLUMN "person_type_id" INTEGER;

-- Backfill: las configs existentes se marcan como legalEntity (id 10). Robusto:
-- resuelve el id por code, no por número mágico, por si difiere entre entornos.
UPDATE "scoring_configurations"
SET "person_type_id" = (
  SELECT "id" FROM "parameters" WHERE "type" = 'person_type' AND "code" = 'legalEntity' LIMIT 1
)
WHERE "person_type_id" IS NULL;

-- Ahora sí, NOT NULL.
ALTER TABLE "scoring_configurations" ALTER COLUMN "person_type_id" SET NOT NULL;

-- Reemplazar el índice de vigencia por el que incluye el tipo.
DROP INDEX "scoring_configurations_company_id_is_active_idx";
CREATE INDEX "scoring_configurations_company_id_person_type_id_is_active_idx"
  ON "scoring_configurations"("company_id", "person_type_id", "is_active");

-- FK a parameters.
ALTER TABLE "scoring_configurations"
  ADD CONSTRAINT "scoring_configurations_person_type_id_fkey"
  FOREIGN KEY ("person_type_id") REFERENCES "parameters"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
