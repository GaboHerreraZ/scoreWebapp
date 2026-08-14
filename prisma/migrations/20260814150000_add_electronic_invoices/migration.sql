-- Facturación electrónica: resolución DIAN + documentos emitidos.
--
-- Con la API de integradores el proveedor NO lleva la numeración: la resolución
-- y el consecutivo son responsabilidad nuestra. De ahí einvoice_resolutions.
--
-- next_consecutive se reserva con un UPDATE atómico acotado por range_final
-- (ver EInvoicingRepository.reserveConsecutive). Dos emisiones simultáneas no
-- pueden tomar el mismo número: ante la DIAN eso sería un documento duplicado,
-- que solo se corrige con nota crédito.

-- CreateTable
CREATE TABLE "einvoice_resolutions" (
    "id" UUID NOT NULL,
    "environment" VARCHAR(20) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "number" BIGINT NOT NULL,
    "range_initial" INTEGER NOT NULL,
    "range_final" INTEGER NOT NULL,
    "next_consecutive" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "einvoice_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "einvoice_resolutions_environment_is_active_idx" ON "einvoice_resolutions"("environment", "is_active");

-- El consecutivo nunca puede salirse del rango autorizado ni retroceder.
ALTER TABLE "einvoice_resolutions" ADD CONSTRAINT "einvoice_resolutions_range_check"
  CHECK ("range_initial" <= "range_final"
     AND "next_consecutive" >= "range_initial"
     AND "next_consecutive" <= "range_final" + 1);

-- CreateTable
CREATE TABLE "electronic_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "analysis_pack_id" UUID,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'aliaddo',
    "environment" VARCHAR(20) NOT NULL,
    "status_id" INTEGER NOT NULL,
    "resolution_id" UUID,
    "prefix" VARCHAR(10),
    "consecutive" INTEGER,
    "number" VARCHAR(50),
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "customer_snapshot" JSONB NOT NULL,
    "lines_snapshot" JSONB NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "tax_base" DOUBLE PRECISION NOT NULL,
    "tax_amount" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "provider_document_id" VARCHAR(100),
    "cufe" VARCHAR(200),
    "qr_data" TEXT,
    "pdf_url" TEXT,
    "xml_url" TEXT,
    "status_reasons" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "sent_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "raw_request" JSONB,
    "raw_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "electronic_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "electronic_invoices_status_id_created_at_idx" ON "electronic_invoices"("status_id", "created_at");
CREATE INDEX "electronic_invoices_company_id_created_at_idx" ON "electronic_invoices"("company_id", "created_at");

-- Un consecutivo no se puede repetir dentro de la misma resolución.
CREATE UNIQUE INDEX "electronic_invoices_resolution_consecutive_key"
  ON "electronic_invoices"("resolution_id", "consecutive")
  WHERE "resolution_id" IS NOT NULL AND "consecutive" IS NOT NULL;

-- Idempotencia: UNA fila por venta, siempre. Un webhook repetido no puede crear
-- una segunda factura de la misma bolsa. Un reintento tras rechazo REUSA esta
-- fila (por eso existen attempts / last_error), no crea otra.
-- Es un único parcial porque analysis_pack_id admite null (facturas manuales
-- sin venta asociada), y Prisma no sabe declarar el WHERE.
CREATE UNIQUE INDEX "electronic_invoices_analysis_pack_key"
  ON "electronic_invoices"("analysis_pack_id")
  WHERE "analysis_pack_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "electronic_invoices" ADD CONSTRAINT "electronic_invoices_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_invoices" ADD CONSTRAINT "electronic_invoices_analysis_pack_id_fkey"
  FOREIGN KEY ("analysis_pack_id") REFERENCES "analysis_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "electronic_invoices" ADD CONSTRAINT "electronic_invoices_status_id_fkey"
  FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_invoices" ADD CONSTRAINT "electronic_invoices_resolution_id_fkey"
  FOREIGN KEY ("resolution_id") REFERENCES "einvoice_resolutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
