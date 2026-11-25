-- ─── Autorización de centrales cargada a mano por la empresa ────────────────
-- Hasta ahora la única forma de satisfacer el gate del bureau era que el titular
-- firmara en línea (Zapsign). Muchas empresas ya tienen la autorización firmada
-- de su cliente y prefieren adjuntarla: estas columnas distinguen ese origen.
--
-- No se agrega una fecha de carga: en una carga manual `signed_at` ES el instante
-- de la carga (el gate se deriva de ahí), y la fecha real de firma del papel no se
-- pide al usuario. El PDF reutiliza `signed_file_storage_path` y el bucket
-- privado `customer-authorizations`, igual que el respaldo de Zapsign.

ALTER TABLE "customer_authorizations"
  ADD COLUMN "signature_source" VARCHAR(20) NOT NULL DEFAULT 'provider',
  ADD COLUMN "signed_file_name" VARCHAR(255),
  ADD COLUMN "uploaded_by" UUID;

-- Quién cargó el documento. SET NULL: borrar el perfil no borra la prueba.
ALTER TABLE "customer_authorizations"
  ADD CONSTRAINT "customer_authorizations_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
