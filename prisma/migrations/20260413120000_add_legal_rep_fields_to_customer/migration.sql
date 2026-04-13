-- AlterTable
ALTER TABLE "customers" ADD COLUMN "legal_rep_identification_type_id" INTEGER;
ALTER TABLE "customers" ADD COLUMN "legal_rep_email" VARCHAR(255);
ALTER TABLE "customers" ADD COLUMN "legal_rep_phone" VARCHAR(50);

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_legal_rep_identification_type_id_fkey" FOREIGN KEY ("legal_rep_identification_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
