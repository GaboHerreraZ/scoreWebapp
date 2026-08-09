-- Representante legal del Customer (solo PJ) promovido de bureauProfile (JSONB)
-- a columnas: la central muchas veces NO lo trae (y nunca trae email/teléfono),
-- y se necesita para la firma del pagaré. Se siembra en la 1ª consulta cuando
-- venga y después es editable vía PATCH; el refresh del bureau no lo pisa.
ALTER TABLE "customers" ADD COLUMN "legal_rep_name" VARCHAR(255);
ALTER TABLE "customers" ADD COLUMN "legal_rep_identification_type_id" INTEGER;
ALTER TABLE "customers" ADD COLUMN "legal_rep_identification_number" VARCHAR(50);
ALTER TABLE "customers" ADD COLUMN "legal_rep_email" VARCHAR(255);
ALTER TABLE "customers" ADD COLUMN "legal_rep_phone" VARCHAR(50);

ALTER TABLE "customers" ADD CONSTRAINT "customers_legal_rep_identification_type_id_fkey"
    FOREIGN KEY ("legal_rep_identification_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
