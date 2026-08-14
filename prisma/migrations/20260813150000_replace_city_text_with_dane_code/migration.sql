-- La ciudad pasa de texto libre a FK contra el catálogo DIVIPOLA (dane_cities).
--
-- Antes: companies.state/city y billing_state/billing_city, customers.state/city,
-- todos VARCHAR con lo que devolvía api-colombia.com. Sin código DANE no se puede
-- facturar electrónicamente (la DIAN valida el par municipio/departamento) y el
-- mismo municipio se guardaba escrito de formas distintas.
--
-- El departamento NO se guarda: son los 2 primeros dígitos del código.
--
-- ⚠️ ORDEN DE EJECUCIÓN: esta migración necesita dane_cities YA POBLADA. El
-- catálogo se carga como data migration (prisma/data/v006), que corre aparte de
-- `prisma migrate deploy`. En cada ambiente, ANTES de aplicar esta migración:
--     DATA_MIGRATION_VERSION=v006  →  npm run data:apply       (staging)
--                                     npm run data:apply:pro   (producción)
-- Si el catálogo está vacío, el bloque de abajo aborta con un mensaje claro en
-- vez de dejar filas a medias.
--
-- El backfill es parte de ESTA migración y no de prisma/data/ porque no se puede
-- borrar el texto sin haber resuelto antes el código: es un solo paso atómico.

-- ── 0. El catálogo tiene que estar cargado ──────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM "dane_cities") = 0 THEN
    RAISE EXCEPTION 'dane_cities está vacía: ejecuta la data migration v006 (npm run data:apply) antes de esta migración';
  END IF;
END $$;

-- ── 1. Columnas nuevas (nullable mientras se rellenan) ──────────────────────
ALTER TABLE "companies" ADD COLUMN "city_code" VARCHAR(5);
ALTER TABLE "companies" ADD COLUMN "billing_city_code" VARCHAR(5);
ALTER TABLE "customers" ADD COLUMN "city_code" VARCHAR(5);

-- ── 2. Backfill por nombre ──────────────────────────────────────────────────
-- Match insensible a mayúsculas, tildes y puntuación, acotado al departamento
-- para desambiguar los 66 nombres de municipio repetidos. Sin departamento no se
-- resuelve nada: se deja NULL antes que adivinar.
CREATE OR REPLACE FUNCTION pg_temp.norm(txt TEXT) RETURNS TEXT AS $$
  SELECT lower(translate(trim(coalesce(txt, '')),
    'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ.,',
    'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'));
$$ LANGUAGE SQL IMMUTABLE;

UPDATE "companies" c
SET "city_code" = dc."code"
FROM "dane_cities" dc
JOIN "dane_regions" dr ON dr."code" = dc."region_code"
WHERE pg_temp.norm(dc."name") = pg_temp.norm(c."city")
  AND pg_temp.norm(dr."name") = pg_temp.norm(c."state");

UPDATE "companies" c
SET "billing_city_code" = dc."code"
FROM "dane_cities" dc
JOIN "dane_regions" dr ON dr."code" = dc."region_code"
WHERE pg_temp.norm(dc."name") = pg_temp.norm(c."billing_city")
  AND pg_temp.norm(dr."name") = pg_temp.norm(c."billing_state");

UPDATE "customers" cu
SET "city_code" = dc."code"
FROM "dane_cities" dc
JOIN "dane_regions" dr ON dr."code" = dc."region_code"
WHERE pg_temp.norm(dc."name") = pg_temp.norm(cu."city")
  AND pg_temp.norm(dr."name") = pg_temp.norm(cu."state");

-- ── 3. companies.city_code es obligatorio: aborta si algo quedó sin resolver ─
-- El domicilio de la empresa es requerido en el onboarding, así que no puede
-- quedar nulo. Si esto revienta, hay que corregir a mano los nombres que no
-- casaron y volver a correr — NO relajar la restricción.
DO $$
DECLARE
  faltantes TEXT;
BEGIN
  SELECT string_agg(format('%s (%s / %s)', "name", "state", "city"), ', ')
    INTO faltantes
    FROM "companies" WHERE "city_code" IS NULL;

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el municipio de estas empresas: %', faltantes;
  END IF;
END $$;

ALTER TABLE "companies" ALTER COLUMN "city_code" SET NOT NULL;

-- ── 4. Claves foráneas ──────────────────────────────────────────────────────
ALTER TABLE "companies" ADD CONSTRAINT "companies_city_code_fkey"
  FOREIGN KEY ("city_code") REFERENCES "dane_cities"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "companies" ADD CONSTRAINT "companies_billing_city_code_fkey"
  FOREIGN KEY ("billing_city_code") REFERENCES "dane_cities"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_city_code_fkey"
  FOREIGN KEY ("city_code") REFERENCES "dane_cities"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 5. Fuera el texto ───────────────────────────────────────────────────────
ALTER TABLE "companies" DROP COLUMN "state";
ALTER TABLE "companies" DROP COLUMN "city";
ALTER TABLE "companies" DROP COLUMN "billing_state";
ALTER TABLE "companies" DROP COLUMN "billing_city";

-- customers.city NO se borra: además del selector, lo siembra la central de
-- riesgo con texto crudo, en mayúsculas y sin departamento ('BOGOTA D.C.'), que
-- no se puede resolver a un código sin ambigüedad. Se renombra para que quede
-- explícito de dónde viene y deje de competir con city_code.
ALTER TABLE "customers" RENAME COLUMN "city" TO "bureau_city";
ALTER TABLE "customers" DROP COLUMN "state";
