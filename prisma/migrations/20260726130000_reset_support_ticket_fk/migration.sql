-- El ticket del reset pasa de texto libre (ticket_ref) a FK real contra
-- support_tickets. ON DELETE SET NULL: si el ticket se borrara, la auditoría
-- del reset se conserva (solo pierde el vínculo).
ALTER TABLE "credit_study_resets" DROP COLUMN "ticket_ref";

ALTER TABLE "credit_study_resets" ADD COLUMN "support_ticket_id" UUID;

CREATE INDEX "credit_study_resets_support_ticket_id_idx" ON "credit_study_resets"("support_ticket_id");

ALTER TABLE "credit_study_resets" ADD CONSTRAINT "credit_study_resets_support_ticket_id_fkey" FOREIGN KEY ("support_ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
