-- El vínculo del ticket pasa de polimórfico débil (related_entity_type +
-- related_entity_id como texto, sin integridad referencial) a FKs TIPADAS:
-- credit_study_id (área credit_study) y customer_id (área customer). El área
-- payment/account/other no necesita id extra: company_id ya ata el ticket.
ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_related_entity_check";

ALTER TABLE "support_tickets" DROP COLUMN "related_entity_type";
ALTER TABLE "support_tickets" DROP COLUMN "related_entity_id";

ALTER TABLE "support_tickets" ADD COLUMN "credit_study_id" UUID;
ALTER TABLE "support_tickets" ADD COLUMN "customer_id" UUID;

CREATE INDEX "support_tickets_credit_study_id_idx" ON "support_tickets"("credit_study_id");
CREATE INDEX "support_tickets_customer_id_idx" ON "support_tickets"("customer_id");

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_credit_study_id_fkey" FOREIGN KEY ("credit_study_id") REFERENCES "credit_studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- El catálogo support_related_entity queda obsoleto (era el enum del campo
-- polimórfico). Se desactiva, no se borra (histórico).
UPDATE "parameters" SET "is_active" = false, "updated_at" = NOW()
WHERE "type" = 'support_related_entity';
