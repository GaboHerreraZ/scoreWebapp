-- Configuración de scoring por empresa, versionada (historial). Cada empresa
-- acumula varias configuraciones en el tiempo; una vigente (is_active). Los
-- pesos por dimensión (columnas) deben sumar 100. El estudio graba el id de la
-- config con la que se analizó (scoring_configuration_id, nullable) → congelación
-- por referencia. Todo nullable/aditivo → no destructiva.
--
-- NOTA: se OMITE el ruido del diff automático (DROP TABLE _data_migrations,
-- invitations fkey drop/re-add, platform_admins default). Ver CLAUDE.md.

-- CreateTable
CREATE TABLE "scoring_configurations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "weight_financial_health" INTEGER NOT NULL,
    "weight_payment_capacity" INTEGER NOT NULL,
    "weight_term_coherence" INTEGER NOT NULL,
    "weight_credit_line_adequacy" INTEGER NOT NULL,
    "weight_capital_exposure" INTEGER NOT NULL,
    "weight_veracity" INTEGER NOT NULL,
    "weight_central_risk" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scoring_configurations_company_id_is_active_idx" ON "scoring_configurations"("company_id", "is_active");

-- AlterTable: el estudio referencia la config con la que se analizó (nullable).
ALTER TABLE "credit_studies" ADD COLUMN "scoring_configuration_id" UUID;

-- AddForeignKey
ALTER TABLE "scoring_configurations" ADD CONSTRAINT "scoring_configurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_configurations" ADD CONSTRAINT "scoring_configurations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_studies" ADD CONSTRAINT "credit_studies_scoring_configuration_id_fkey" FOREIGN KEY ("scoring_configuration_id") REFERENCES "scoring_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
