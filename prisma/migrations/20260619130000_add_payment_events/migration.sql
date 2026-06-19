-- Log crudo de los eventos de pago de ePayco: una fila por cada confirmación que
-- llega al webhook (rechazo, pago, reversa...). Append-only, conserva el payload
-- completo para auditoría/debug y disputas. Complementa AnalysisPack (1 x bolsa).
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "analysis_pack_id" UUID,
    "company_id" UUID,
    "epayco_ref" VARCHAR(100),
    "epayco_transaction_id" VARCHAR(100),
    "cod_response" INTEGER,
    "response_text" VARCHAR(255),
    "amount" DOUBLE PRECISION,
    "currency_code" VARCHAR(10),
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_events_analysis_pack_id_created_at_idx" ON "payment_events"("analysis_pack_id", "created_at");
CREATE INDEX "payment_events_epayco_transaction_id_idx" ON "payment_events"("epayco_transaction_id");

ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_analysis_pack_id_fkey" FOREIGN KEY ("analysis_pack_id") REFERENCES "analysis_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
