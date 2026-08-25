-- Onboarding simplificado: la empresa nace solo con el nombre (+ facturación) y
-- el NIT, sector, ciudad y dirección se completan después desde la app, con
-- gates por función (estudios/autorizaciones exigen NIT; el pagaré exige
-- dirección y ciudad). Esto revierte a propósito la decisión de la migración
-- 20260813150000 de mantener city_code NOT NULL: el domicilio ya no se pide en
-- el onboarding.
-- El unique de "nit" se conserva: en Postgres los NULL no colisionan entre sí.

ALTER TABLE "companies" ALTER COLUMN "nit" DROP NOT NULL;
ALTER TABLE "companies" ALTER COLUMN "sector_id" DROP NOT NULL;
ALTER TABLE "companies" ALTER COLUMN "city_code" DROP NOT NULL;
ALTER TABLE "companies" ALTER COLUMN "address" DROP NOT NULL;
