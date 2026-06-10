-- Diferencia el origen de la invitación:
--   'account_onboarding' = alta nueva de empresa desde el portal admin (rol owner)
--   'collaboration'      = invitar a un colaborador a una empresa existente
-- Las filas existentes quedan como 'collaboration' (el flujo histórico).
ALTER TABLE "invitations"
  ADD COLUMN IF NOT EXISTS "type" VARCHAR(30) NOT NULL DEFAULT 'collaboration';
