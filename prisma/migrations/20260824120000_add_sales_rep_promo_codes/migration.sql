-- Descuentos financiados por el vendedor.
--
-- El vendedor puede emitir sus propios códigos promocionales para cerrar ventas
-- nuevas, pero el descuento sale de SU comisión, no del margen de Creditia:
--
--   comisión neta = max(0, % × base de LISTA − descuento que él otorgó)
--
-- Con eso el neto de Creditia queda constante y el vendedor cambia comisión por
-- tasa de cierre 1 a 1. A los 30% (el techo) su ganancia de esa primera venta es
-- cero, pero conserva el 10% de todas las recompras.
--
-- Un código de vendedor NO atribuye: solo lo puede canjear una empresa que YA
-- está vinculada a él. La atribución sigue siendo del código de vendedor, que se
-- teclea en el registro o lo corrige un admin dentro de la ventana.

-- 1. Techo del descuento, versionado junto con los porcentajes del plan.
ALTER TABLE "commission_plans"
  ADD COLUMN IF NOT EXISTS "max_new_customer_discount" DECIMAL(5,2) NOT NULL DEFAULT 30;

-- 2. Catálogo del tipo de código. 'first_purchase' es el único que puede emitir
--    un vendedor; 'any' es el comportamiento histórico (campañas de Creditia).
INSERT INTO "parameters" ("type", "code", "label", "description", "sort_order", "is_active", "created_at", "updated_at")
VALUES
  ('promo_code_applies_to', 'any',            'Cualquier compra', 'Aplica a cualquier compra de la empresa', 1, true, NOW(), NOW()),
  ('promo_code_applies_to', 'first_purchase', 'Primera compra',   'Solo la primera compra facturada de la empresa', 2, true, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- 3. Los dos ejes del código: a qué compra aplica y quién financia el descuento.
--    applies_to_id entra nullable, se rellena con 'any' y recién ahí se vuelve
--    NOT NULL: las filas existentes son campañas de Creditia sin restricción.
ALTER TABLE "promo_codes"
  ADD COLUMN IF NOT EXISTS "applies_to_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "sales_rep_id"  UUID;

UPDATE "promo_codes"
   SET "applies_to_id" = (SELECT "id" FROM "parameters" WHERE "type" = 'promo_code_applies_to' AND "code" = 'any')
 WHERE "applies_to_id" IS NULL;

ALTER TABLE "promo_codes" ALTER COLUMN "applies_to_id" SET NOT NULL;

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_applies_to_id_fkey"
  FOREIGN KEY ("applies_to_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT: un vendedor con códigos emitidos no se puede borrar sin resolverlos
-- (además sales_reps no se borra nunca; se desactiva con is_active).
ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_sales_rep_id_fkey"
  FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "promo_codes_sales_rep_id_idx" ON "promo_codes"("sales_rep_id");

-- 4. Congelar en la bolsa lo que hoy se pierde: la base ANTES del descuento (que
--    es la base de la comisión) y si el precio traía IVA incluido.
ALTER TABLE "analysis_packs"
  ADD COLUMN IF NOT EXISTS "list_tax_base"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "tax_included_paid" BOOLEAN;

-- Sin código promocional, la base cobrada ES la de lista. Con código no se puede
-- reconstruir sin saber el modo de IVA que rigió, así que esas quedan en NULL y
-- el código cae al fallback. Son bolsas ya comisionadas: no cambia nada del pasado.
UPDATE "analysis_packs"
   SET "list_tax_base" = "tax_base"
 WHERE "list_tax_base" IS NULL
   AND "tax_base" IS NOT NULL
   AND "promo_code_id" IS NULL;

-- El modo de IVA sí se recupera: viene del precio que rigió la compra.
UPDATE "analysis_packs" ap
   SET "tax_included_paid" = cp."tax_included"
  FROM "consultation_prices" cp
 WHERE ap."consultation_price_id" = cp."id"
   AND ap."tax_included_paid" IS NULL;

-- 5. Desglose de la liquidación en el ledger. En lo ya causado no hubo descuento
--    de vendedor: bruta = neta y financiado = 0.
ALTER TABLE "sales_commissions"
  ADD COLUMN IF NOT EXISTS "list_base_amount"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "gross_commission_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_funded_amount"  DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "sales_commissions"
   SET "list_base_amount"        = "base_amount",
       "gross_commission_amount" = "commission_amount"
 WHERE "list_base_amount" = 0;
