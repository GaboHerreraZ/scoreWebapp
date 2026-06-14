-- Plan ofrecible en el catálogo vigente. Al versionar el ConsultationPrice se
-- recrean los planes con el precio nuevo (is_current=true) y los viejos pasan a
-- is_current=false: dejan de ofrecerse en el onboarding pero siguen is_active=true
-- y sin cancelar en ePayco, para no romper los cobros recurrentes existentes.
-- Los planes actuales nacen is_current=true (el default cubre las filas existentes).

-- AddColumn
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "is_current" BOOLEAN NOT NULL DEFAULT true;
