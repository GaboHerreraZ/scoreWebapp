-- Catálogo DIVIPOLA: departamentos y municipios de Colombia con código DANE.
--
-- Reemplaza la dependencia de api-colombia.com (consumida desde el navegador en
-- el onboarding, la ficha de cliente y el estudio de crédito), cuyos ids eran
-- propios del servicio y no códigos DANE. La factura electrónica exige el código
-- oficial: la DIAN valida que los 2 primeros dígitos del municipio coincidan con
-- los del departamento, y por eso region_code es FK.
--
-- Las filas se cargan como data migration (prisma/data/v006), no aquí: son 1.156
-- registros de catálogo, no cambio de esquema.

-- CreateTable
CREATE TABLE "dane_regions" (
    "code" VARCHAR(2) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dane_regions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "dane_cities" (
    "code" VARCHAR(5) NOT NULL,
    "region_code" VARCHAR(2) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "dian_name" VARCHAR(150) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dane_cities_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "dane_cities_region_code_name_idx" ON "dane_cities"("region_code", "name");

-- AddForeignKey
ALTER TABLE "dane_cities" ADD CONSTRAINT "dane_cities_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "dane_regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
