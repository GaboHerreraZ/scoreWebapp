-- En el onboarding del portal admin, quien invita es el equipo Creditia (un
-- platform_admin), que NO tiene Profile. invited_by referencia profiles, por lo
-- que debe poder ser NULL cuando la invitación la origina un admin de plataforma.
ALTER TABLE "invitations" ALTER COLUMN "invited_by" DROP NOT NULL;
