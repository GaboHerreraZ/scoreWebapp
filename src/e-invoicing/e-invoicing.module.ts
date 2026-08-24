import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { EInvoicingController } from './e-invoicing.controller.js';
import { BranchesController } from './branches.controller.js';
import { EInvoicingService } from './e-invoicing.service.js';
import { EInvoiceItemsService } from './einvoice-items.service.js';
import { EInvoicingRepository } from './e-invoicing.repository.js';
import { FiscalProfileValidator } from './fiscal-profile.validator.js';
import { AliaddoClient } from './aliaddo/aliaddo.client.js';
import { AliaddoProvider } from './providers/aliaddo.provider.js';
import { E_INVOICE_PROVIDER } from './providers/e-invoice-provider.interface.js';

/**
 * Facturación electrónica. Mismo patrón que CreditBureauModule: los services
 * solo conocen el puerto (E_INVOICE_PROVIDER) y los tipos de dominio.
 *
 * Cambiar de proveedor = escribir una carpeta hermana de `aliaddo/` con su
 * client + mapper + provider, y cambiar el useClass de abajo. Ni los services,
 * ni el repositorio, ni el esquema se tocan.
 */
@Module({
  imports: [PrismaModule, ParametersModule],
  controllers: [EInvoicingController, BranchesController],
  providers: [
    EInvoicingService,
    EInvoiceItemsService,
    EInvoicingRepository,
    FiscalProfileValidator,
    AliaddoClient,
    AliaddoProvider,
    { provide: E_INVOICE_PROVIDER, useClass: AliaddoProvider },
  ],
  exports: [EInvoicingService, FiscalProfileValidator],
})
export class EInvoicingModule {}
