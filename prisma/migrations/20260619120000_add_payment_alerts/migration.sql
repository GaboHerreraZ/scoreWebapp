-- Alertas de pago: incidentes de cobro que el admin debe gestionar (p.ej. pago
-- reversado). type/severity/status son Parameter. metadata guarda datos del
-- incidente (ref ePayco, monto, créditos consumidos, etc.).
CREATE TABLE "payment_alerts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "analysis_pack_id" UUID,
    "type_id" INTEGER NOT NULL,
    "severity_id" INTEGER NOT NULL,
    "status_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_alerts_company_id_status_id_idx" ON "payment_alerts"("company_id", "status_id");
CREATE INDEX "payment_alerts_status_id_created_at_idx" ON "payment_alerts"("status_id", "created_at");

ALTER TABLE "payment_alerts" ADD CONSTRAINT "payment_alerts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_alerts" ADD CONSTRAINT "payment_alerts_analysis_pack_id_fkey" FOREIGN KEY ("analysis_pack_id") REFERENCES "analysis_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_alerts" ADD CONSTRAINT "payment_alerts_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_alerts" ADD CONSTRAINT "payment_alerts_severity_id_fkey" FOREIGN KEY ("severity_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_alerts" ADD CONSTRAINT "payment_alerts_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_alerts" ADD CONSTRAINT "payment_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed de parámetros de las alertas de pago. Idempotente.
-- created_at/updated_at en SQL (los @default de Prisma son client-side).
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  -- Tipos de alerta
  ('payment_alert_type', 'payment_reversed', 'Pago reversado', 'Un pago aprobado fue reversado/devuelto', true, 0, NOW(), NOW()),
  -- Severidades
  ('payment_alert_severity', 'info', 'Informativa', 'Informativa, sin acción urgente', true, 0, NOW(), NOW()),
  ('payment_alert_severity', 'warning', 'Advertencia', 'Requiere atención', true, 1, NOW(), NOW()),
  ('payment_alert_severity', 'critical', 'Crítica', 'Requiere acción inmediata', true, 2, NOW(), NOW()),
  -- Estados de gestión
  ('payment_alert_status', 'open', 'Abierta', 'Alerta sin atender', true, 0, NOW(), NOW()),
  ('payment_alert_status', 'in_progress', 'En gestión', 'Alerta en proceso de resolución', true, 1, NOW(), NOW()),
  ('payment_alert_status', 'resolved', 'Resuelta', 'Alerta resuelta', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
