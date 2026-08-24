import { Module } from '@nestjs/common';
import { ZapsignWebhooksController } from './zapsign-webhooks.controller.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { CustomerAuthorizationsModule } from '../customer-authorizations/customer-authorizations.module.js';

/**
 * Punto único de entrada de los webhooks de Zapsign. Zapsign manda todos los
 * eventos de la cuenta a una sola URL, así que aquí vive el despachador que los
 * enruta por token al pagaré o a la autorización del titular. Importa ambos
 * features por sus services exportados (DocumentsModule reexporta
 * PromissoryNotesModule; CustomerAuthorizationsModule exporta el suyo).
 */
@Module({
  imports: [DocumentsModule, CustomerAuthorizationsModule],
  controllers: [ZapsignWebhooksController],
})
export class ZapsignWebhooksModule {}
