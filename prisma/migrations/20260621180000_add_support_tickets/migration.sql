-- Tickets de soporte de las empresas a Creditia. area/type/priority/status son
-- Parameter. relatedEntityType/Id apuntan opcionalmente a un registro (ambos
-- null o ambos presentes, garantizado por CHECK). reference (SUP-AAAA-######)
-- se genera con el contador atómico support_ticket_counters.
-- created_at/updated_at del seed en SQL.

-- ── Seed de parámetros (5 catálogos) ────────────────────────────────────
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  -- Áreas
  ('support_area', 'credit_study', 'Análisis de crédito', 'Problemas con un análisis/estudio de crédito', true, 0, NOW(), NOW()),
  ('support_area', 'customer', 'Clientes', 'Problemas con la gestión de un cliente', true, 1, NOW(), NOW()),
  ('support_area', 'payment', 'Pagos y paquetes', 'Pagos, bolsas o facturación', true, 2, NOW(), NOW()),
  ('support_area', 'account', 'Cuenta y plan', 'Cuenta, perfil, usuarios, empresa o plan', true, 3, NOW(), NOW()),
  ('support_area', 'other', 'Otro', 'No encaja en las anteriores', true, 4, NOW(), NOW()),
  -- Tipos
  ('support_type', 'bug', 'Error', 'Reporte de un error del sistema', true, 0, NOW(), NOW()),
  ('support_type', 'question', 'Consulta', 'Duda o pregunta de uso', true, 1, NOW(), NOW()),
  ('support_type', 'request', 'Solicitud', 'Solicitud de cambio o ayuda', true, 2, NOW(), NOW()),
  -- Prioridades
  ('support_priority', 'low', 'Baja', 'Prioridad baja', true, 0, NOW(), NOW()),
  ('support_priority', 'medium', 'Media', 'Prioridad media', true, 1, NOW(), NOW()),
  ('support_priority', 'high', 'Alta', 'Prioridad alta', true, 2, NOW(), NOW()),
  -- Estados de gestión
  ('support_status', 'open', 'Abierto', 'Ticket sin atender', true, 0, NOW(), NOW()),
  ('support_status', 'in_progress', 'En gestión', 'Ticket en proceso de atención', true, 1, NOW(), NOW()),
  ('support_status', 'closed', 'Cerrado', 'Ticket atendido/cerrado', true, 2, NOW(), NOW()),
  -- Tipos de registro relacionado (valores válidos para related_entity_type)
  ('support_related_entity', 'credit_study', 'Estudio de crédito', 'Vincula un estudio', true, 0, NOW(), NOW()),
  ('support_related_entity', 'customer', 'Cliente', 'Vincula un cliente', true, 1, NOW(), NOW()),
  ('support_related_entity', 'payment', 'Pago/Bolsa', 'Vincula un pago o bolsa', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- ── Contador del reference (uno por año) ────────────────────────────────
CREATE TABLE "support_ticket_counters" (
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "support_ticket_counters_pkey" PRIMARY KEY ("year")
);

-- ── Tabla: support_tickets ──────────────────────────────────────────────
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "company_id" UUID NOT NULL,
    "area_id" INTEGER NOT NULL,
    "type_id" INTEGER NOT NULL,
    "priority_id" INTEGER NOT NULL,
    "status_id" INTEGER NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "related_entity_type" VARCHAR(50),
    "related_entity_id" VARCHAR(100),
    "context" JSONB,
    "assigned_to" UUID,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
    -- Ambos null o ambos presentes (no se permite uno solo).
    CONSTRAINT "support_tickets_related_entity_check" CHECK (
      ("related_entity_type" IS NULL AND "related_entity_id" IS NULL)
      OR ("related_entity_type" IS NOT NULL AND "related_entity_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "support_tickets_reference_key" ON "support_tickets"("reference");
CREATE INDEX "support_tickets_company_id_created_at_idx" ON "support_tickets"("company_id", "created_at");
CREATE INDEX "support_tickets_status_id_created_at_idx" ON "support_tickets"("status_id", "created_at");

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
