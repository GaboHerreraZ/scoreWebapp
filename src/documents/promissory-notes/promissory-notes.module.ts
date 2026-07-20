import { Module } from '@nestjs/common';
import { PromissoryNotesController } from './promissory-notes.controller.js';
import { PromissoryNotesService } from './promissory-notes.service.js';
import { PromissoryNotesRepository } from './promissory-notes.repository.js';
import { ParametersModule } from '../../parameters/parameters.module.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';
import { SigningModule } from '../signing/signing.module.js';

/**
 * Documento firmable: pagaré del estudio de crédito viable, firmado por el
 * consultado vía la capa de firma compartida (SigningModule → Zapsign). Los
 * webhooks del proveedor los recibe el despachador único (ZapsignWebhooksModule)
 * y los enruta aquí por doc token; por eso el service se exporta.
 */
@Module({
  imports: [ParametersModule, NotificationsModule, SigningModule],
  controllers: [PromissoryNotesController],
  providers: [PromissoryNotesService, PromissoryNotesRepository],
  exports: [PromissoryNotesService],
})
export class PromissoryNotesModule {}
