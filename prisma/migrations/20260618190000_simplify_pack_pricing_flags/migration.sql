-- Limpieza del modelo de packs: unifica flags y elimina el descuento muerto.

-- 1) pack_offerings: unifica los flags de visibilidad en uno solo (isActive).
-- isCurrent era redundante (el catálogo exigía isActive=true AND isCurrent=true);
-- ahora isActive es el único flag de "ofrecible en el catálogo". Retirar una
-- oferta vendida = isActive=false (no rompe las AnalysisPack que la referencian).
ALTER TABLE "pack_offerings" DROP COLUMN "is_current";

-- 2) consultation_prices: elimina el descuento informativo. unitPrice ya es el
-- precio FINAL por consulta; estos campos nunca se usaron en ningún cálculo.
-- El único descuento del sistema (por volumen) vive en pack_offerings.
ALTER TABLE "consultation_prices" DROP CONSTRAINT "consultation_prices_discount_type_id_fkey";
ALTER TABLE "consultation_prices" DROP COLUMN "has_discount";
ALTER TABLE "consultation_prices" DROP COLUMN "base_price";
ALTER TABLE "consultation_prices" DROP COLUMN "discount_type_id";
ALTER TABLE "consultation_prices" DROP COLUMN "discount_value";

-- 3) consultation_prices: elimina la vigencia por fechas. El precio activo se
-- decide solo por isActive (un único registro activo); el historial queda por
-- createdAt/updatedAt. validFrom/validUntil no controlaban nada y sobraban.
ALTER TABLE "consultation_prices" DROP COLUMN "valid_from";
ALTER TABLE "consultation_prices" DROP COLUMN "valid_until";
