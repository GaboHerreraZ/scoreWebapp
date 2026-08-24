-- Facturación electrónica contra la API contable del facturador.
--
-- Ese modelo NO recibe el documento fiscal completo: la factura solo REFERENCIA
-- maestros que ya tienen que existir en la cuenta del facturador (tercero,
-- producto, impuesto, sucursal). Estas dos tablas son el puente, y están escritas
-- sin nombrar al proveedor (`provider` + `provider*_id`): cambiar de facturador
-- no toca el esquema.
--
--   einvoice_items        → catálogo de ítems facturables. Fuente de verdad NUESTRA;
--                           el facturador guarda una copia enlazada por provider_item_id.
--   einvoice_contact_refs → vínculo empresa ↔ tercero, para no rebuscar en cada compra.
--
-- La numeración propia (einvoice_resolutions, prefix, consecutive) queda como
-- LEGADO: no se borra porque un documento emitido tiene que poder mostrar bajo
-- qué autorización se expidió, y la DIAN puede pedirlo años después.

-- CreateTable
CREATE TABLE "einvoice_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "unit_measurement_code" VARCHAR(10) NOT NULL DEFAULT '94',
    "price_sell" DOUBLE PRECISION,
    "tax_rate" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'aliaddo',
    "provider_item_id" VARCHAR(100),
    "provider_item_code" VARCHAR(50),
    "provider_tax_ids" JSONB,
    -- Categoría y unidad del facturador: su edición REEMPLAZA el producto, así
    -- que hay que poder reenviarlas o se pierden.
    "provider_category_ref" VARCHAR(100),
    "provider_measuring_unit_ref" VARCHAR(100),
    "provider_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "einvoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "einvoice_items_code_key" ON "einvoice_items"("code");

-- CreateIndex
-- Dos ítems nuestros no pueden apuntar al mismo producto del facturador: sería
-- facturar dos conceptos distintos con el mismo código.
CREATE UNIQUE INDEX "einvoice_items_provider_provider_item_id_key"
    ON "einvoice_items"("provider", "provider_item_id");

-- CreateTable
CREATE TABLE "einvoice_contact_refs" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'aliaddo',
    "company_id" UUID NOT NULL,
    "provider_contact_id" VARCHAR(100) NOT NULL,
    -- Con qué documento se resolvió. Si la empresa cambia su identificación, el
    -- vínculo deja de ser válido y hay que volver a buscarlo.
    "identification" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(255),
    "linked_by" UUID,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "einvoice_contact_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "einvoice_contact_refs_provider_company_id_key"
    ON "einvoice_contact_refs"("provider", "company_id");

-- AddForeignKey
ALTER TABLE "einvoice_contact_refs" ADD CONSTRAINT "einvoice_contact_refs_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einvoice_contact_refs" ADD CONSTRAINT "einvoice_contact_refs_linked_by_fkey"
    FOREIGN KEY ("linked_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- Con qué ítem se factura cada oferta del catálogo. Sin esto no se puede emitir:
-- el facturador exige un código de producto que exista en su cuenta.
ALTER TABLE "pack_offerings" ADD COLUMN "einvoice_item_id" UUID;

-- AddForeignKey
ALTER TABLE "pack_offerings" ADD CONSTRAINT "pack_offerings_einvoice_item_id_fkey"
    FOREIGN KEY ("einvoice_item_id") REFERENCES "einvoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- Maestros con los que se emitió (la anulación y la reconsulta van contra ELLOS,
-- no contra los datos de hoy), estado crudo del facturador y rastro de anulación.
ALTER TABLE "electronic_invoices"
    ADD COLUMN "provider_contact_id" VARCHAR(100),
    ADD COLUMN "provider_branch_id" VARCHAR(100),
    ADD COLUMN "provider_status" JSONB,
    ADD COLUMN "voided_at" TIMESTAMP(3),
    ADD COLUMN "voided_by" UUID,
    ADD COLUMN "void_reason" VARCHAR(500);

-- AddForeignKey
ALTER TABLE "electronic_invoices" ADD CONSTRAINT "electronic_invoices_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- El único parcial era "UNA fila por venta, siempre". Con la anulación eso deja
-- de servir: reemitir tras anular reusaría la fila anulada y borraría su CUFE,
-- su PDF y el motivo — justo la evidencia que la DIAN puede pedir después.
--
-- Ahora la unicidad excluye las anuladas: una venta tiene como máximo UNA factura
-- viva (la idempotencia frente a un doble clic sigue garantizada) y todas las
-- anuladas que hagan falta, cada una con su historia intacta.
DROP INDEX IF EXISTS "electronic_invoices_analysis_pack_key";

CREATE UNIQUE INDEX "electronic_invoices_analysis_pack_key"
  ON "electronic_invoices"("analysis_pack_id")
  WHERE "analysis_pack_id" IS NOT NULL AND "voided_at" IS NULL;

-- Estado 'cancelled': la factura fue anulada ante el facturador. Va aquí y no en
-- una data migration porque el módulo no puede anular sin él.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('einvoice_status', 'cancelled', 'Anulada', 'Anulada ante el facturador; ver motivo y fecha de anulación', true, 5, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
