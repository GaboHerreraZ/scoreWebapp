-- Leads del formulario público de contacto comercial. subject/status son
-- Parameter; los campos de gestión (assigned_to/handled_by/...) permiten al
-- equipo comercial gestionar cada lead desde el panel. created_at/updated_at en
-- SQL (los @default de Prisma son client-side).

-- ── Seed de parámetros ──────────────────────────────────────────────────
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  -- Asuntos del formulario
  ('contact_subject', 'demo', 'Demo', 'Solicitud de demostración', true, 0, NOW(), NOW()),
  ('contact_subject', 'pricing', 'Precios', 'Consulta sobre precios', true, 1, NOW(), NOW()),
  ('contact_subject', 'integration', 'Integración', 'Consulta sobre integración', true, 2, NOW(), NOW()),
  ('contact_subject', 'volume', 'Volumen', 'Consulta por alto volumen de consultas', true, 3, NOW(), NOW()),
  ('contact_subject', 'support', 'Soporte', 'Solicitud de soporte', true, 4, NOW(), NOW()),
  ('contact_subject', 'other', 'Otro', 'Otro asunto', true, 5, NOW(), NOW()),
  -- Estados de gestión del lead
  ('contact_status', 'new', 'Nueva', 'Solicitud sin atender', true, 0, NOW(), NOW()),
  ('contact_status', 'in_progress', 'En gestión', 'Solicitud en proceso de atención', true, 1, NOW(), NOW()),
  ('contact_status', 'closed', 'Cerrada', 'Solicitud atendida/cerrada', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- ── Tabla: contact_requests ─────────────────────────────────────────────
CREATE TABLE "contact_requests" (
    "id" UUID NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "company_name" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "message" TEXT NOT NULL,
    "status_id" INTEGER NOT NULL,
    "assigned_to" UUID,
    "handled_by" UUID,
    "handled_at" TIMESTAMP(3),
    "notes" TEXT,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_requests_status_id_created_at_idx" ON "contact_requests"("status_id", "created_at");
CREATE INDEX "contact_requests_subject_id_idx" ON "contact_requests"("subject_id");

ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
