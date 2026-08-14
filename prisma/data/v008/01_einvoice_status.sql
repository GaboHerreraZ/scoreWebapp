-- Estados del documento fiscal (electronic_invoices.status_id).
--
-- El ciclo: pending → sending → accepted | rejected.
--   pending  = registrada, todavía no se envió (o el kill switch está apagado).
--   sending  = enviada y sin veredicto de la DIAN; hay que reconsultarla.
--   accepted = la DIAN la aprobó y tiene CUFE. Es el único estado con validez.
--   rejected = rechazada; el motivo queda en status_reasons y se puede reintentar.
--
-- UPSERT sobre (type, code): idempotente. El runner envuelve el archivo en una
-- transacción, así que no va BEGIN.

INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at") VALUES
  ('einvoice_status', 'pending',  'Pendiente de envío', 'Registrada, aún no enviada al proveedor',        true, 1, NOW(), NOW()),
  ('einvoice_status', 'sending',  'Enviada',            'Enviada, esperando veredicto de la DIAN',        true, 2, NOW(), NOW()),
  ('einvoice_status', 'accepted', 'Aceptada',           'Aprobada por la DIAN, con CUFE',                 true, 3, NOW(), NOW()),
  ('einvoice_status', 'rejected', 'Rechazada',          'Rechazada; ver motivos y reintentar',            true, 4, NOW(), NOW())
ON CONFLICT ("type", "code") DO UPDATE
SET "label" = EXCLUDED."label",
    "description" = EXCLUDED."description",
    "is_active" = EXCLUDED."is_active",
    "sort_order" = EXCLUDED."sort_order",
    "updated_at" = NOW();
