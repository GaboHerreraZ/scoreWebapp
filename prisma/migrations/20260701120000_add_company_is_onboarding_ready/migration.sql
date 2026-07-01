-- Onboarding listo por empresa: perfil + empresa creados Y primer pack pagado
-- (AnalysisPack en estado 'active'). Nace en false; el webhook de ePayco lo pone
-- en true al activar la primera bolsa. El front lo lee tras el login para saber
-- si el onboarding quedó pendiente en algún paso.
-- NOTA: NO aplicada aún (pendiente migrate:deploy cuando se despliegue).

-- AlterTable
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "is_onboarding_ready" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: las empresas que YA tienen al menos una bolsa activa (pago confirmado)
-- ya completaron el onboarding, así que se marcan como listas. Se compara contra
-- el parámetro de estado 'active' del tipo 'analysis_pack_status'.
UPDATE "companies" c
SET "is_onboarding_ready" = true
WHERE EXISTS (
  SELECT 1
  FROM "analysis_packs" ap
  JOIN "parameters" p ON p."id" = ap."status_id"
  WHERE ap."company_id" = c."id"
    AND p."type" = 'analysis_pack_status'
    AND p."code" = 'active'
);
