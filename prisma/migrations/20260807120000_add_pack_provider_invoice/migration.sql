-- Referencia de factura enviada a la pasarela (x_id_factura), única POR INTENTO.
-- Antes se derivaba como 'PACK-' || id, lo que hacía que un reintento de pago
-- sobre la misma bolsa reusara la invoice y ePayco lo rechazara con
-- "La transacción que intentas pagar ya cuenta con un registro previo".
ALTER TABLE "analysis_packs" ADD COLUMN "provider_invoice" VARCHAR(100);

-- Backfill: las bolsas existentes usaron 'PACK-' || id como invoice.
UPDATE "analysis_packs"
SET "provider_invoice" = 'PACK-' || "id"
WHERE "total_paid" > 0;
