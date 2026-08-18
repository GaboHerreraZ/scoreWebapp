ALTER TABLE "companies" ADD COLUMN "legal_rep_name" VARCHAR(255);
ALTER TABLE "companies" ADD COLUMN "legal_rep_identification_type_id" INTEGER;
ALTER TABLE "companies" ADD COLUMN "legal_rep_identification_number" VARCHAR(50);
ALTER TABLE "companies" ADD COLUMN "legal_rep_email" VARCHAR(255);
ALTER TABLE "companies" ADD COLUMN "legal_rep_phone" VARCHAR(50);

ALTER TABLE "companies" ADD CONSTRAINT "companies_legal_rep_identification_type_id_fkey"
    FOREIGN KEY ("legal_rep_identification_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
