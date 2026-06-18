-- Datos del comprobante de pago de ePayco (de la confirmación), para recibo,
-- conciliación bancaria, soporte y para distinguir transacciones de prueba.
ALTER TABLE "analysis_packs" ADD COLUMN "epayco_franchise" VARCHAR(20);
ALTER TABLE "analysis_packs" ADD COLUMN "epayco_card_last4" VARCHAR(30);
ALTER TABLE "analysis_packs" ADD COLUMN "epayco_approval_code" VARCHAR(40);
ALTER TABLE "analysis_packs" ADD COLUMN "epayco_response_reason" VARCHAR(255);
ALTER TABLE "analysis_packs" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "analysis_packs" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
