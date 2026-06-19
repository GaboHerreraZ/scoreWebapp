-- Nuevo tipo de alerta para pagos rechazados/fallidos (cod_response 2 y 4 de
-- ePayco). A diferencia de la reversa, NO genera correo: solo queda registrada
-- en el panel admin con severidad informativa, ya que el cliente puede
-- reintentar el pago en el mismo checkout y no hubo cobro real.
-- Idempotente. created_at/updated_at en SQL (los @default de Prisma son client-side).
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('payment_alert_type', 'payment_failed', 'Pago rechazado', 'Un intento de pago fue rechazado o fallido', true, 1, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
