-- Smart Checkout v2: identificador de sesión de pago de ePayco por intento de
-- compra de bolsa. Se guarda en el AnalysisPack al crear la sesión (uno por
-- intento). NOTA: NO aplicada aún (pendiente migrate:deploy cuando se despliegue).

-- AlterTable
ALTER TABLE "analysis_packs"
  ADD COLUMN IF NOT EXISTS "epayco_session_id" VARCHAR(100);
