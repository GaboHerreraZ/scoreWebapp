-- Perfil fiscal del adquirente, exigido por la DIAN para emitir factura
-- electrónica y que hoy no capturábamos en ninguna parte.
--
-- No se puede derivar del tipo de documento: una persona natural puede ser
-- responsable de IVA y una jurídica puede estar en el régimen simple. Hay que
-- preguntárselo al cliente.
--
-- Los códigos de ambos catálogos SON los de la DIAN (Parameter.code): el
-- catálogo es suyo, así que traducirlo a códigos propios sería ceremonia inútil.
-- Se siembran en la data migration v007.
--
-- Nullable / array vacío: las empresas que ya existen quedan sin perfil fiscal y
-- lo completan la próxima vez que entren a facturación. El checkout de bolsas
-- valida que esté completo ANTES de cobrar, para no acumular ventas imposibles
-- de facturar.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "billing_regime_type_id" INTEGER;
ALTER TABLE "companies" ADD COLUMN "billing_fiscal_responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_billing_regime_type_id_fkey"
  FOREIGN KEY ("billing_regime_type_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
