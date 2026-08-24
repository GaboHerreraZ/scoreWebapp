-- Ficha completa del usuario del portal: apellidos, identificación y domicilio.
-- Hacen falta para el equipo interno (contratos y, sobre todo, para pagarle las
-- comisiones a los vendedores del programa de referidos).
--
-- Todo nullable: las cuentas que ya existen no tienen estos datos y no se les
-- obliga a completarlos retroactivamente.
--
-- El departamento NO se guarda: se deriva del municipio vía dane_cities.region,
-- igual que en companies y customers.

ALTER TABLE "platform_admins" ADD COLUMN "last_name" VARCHAR(150);
ALTER TABLE "platform_admins" ADD COLUMN "identification_type_id" INTEGER;
ALTER TABLE "platform_admins" ADD COLUMN "identification_number" VARCHAR(50);
ALTER TABLE "platform_admins" ADD COLUMN "address" VARCHAR(255);
ALTER TABLE "platform_admins" ADD COLUMN "city_code" VARCHAR(5);

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_identification_type_id_fkey"
    FOREIGN KEY ("identification_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_city_code_fkey"
    FOREIGN KEY ("city_code") REFERENCES "dane_cities"("code") ON DELETE SET NULL ON UPDATE CASCADE;
