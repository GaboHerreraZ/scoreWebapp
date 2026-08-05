-- Firma del representante legal de Creditia por API en el contrato macro
-- (endpoint /sign/ de Zapsign, add-on "Batch signing"). Solo se usan cuando
-- ZAPSIGN_CREDITIA_USER_TOKEN está configurado; si no, la firma de Creditia
-- sigue yendo pre-impresa en la plantilla y ambas columnas quedan en NULL.
--
-- creditia_signed_at NULL con creditia_signer_token NO NULL = firma encolada
-- pero aún sin confirmar: el webhook doc_signed la reintenta antes de dar el
-- documento por completo (si no, la cuenta de la empresa nunca se activaría).
ALTER TABLE "contract_signatures" ADD COLUMN "creditia_signer_token" VARCHAR(100);
ALTER TABLE "contract_signatures" ADD COLUMN "creditia_signed_at" TIMESTAMP(3);
