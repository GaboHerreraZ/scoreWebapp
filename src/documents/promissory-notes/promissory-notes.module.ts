import { Module } from '@nestjs/common';
import { PromissoryNotesController } from './promissory-notes.controller.js';
import { PromissoryNotesService } from './promissory-notes.service.js';
import { PromissoryNotesRepository } from './promissory-notes.repository.js';
import { SigningModule } from '../signing/signing.module.js';
import { ParametersModule } from '../../parameters/parameters.module.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';

/**
 * Documento firmable: pagaré. Usa la capa de firma compartida (SigningModule)
 * para el cliente DocuSeal y el guard del webhook.
 */
@Module({
  imports: [SigningModule, ParametersModule, NotificationsModule],
  controllers: [PromissoryNotesController],
  providers: [PromissoryNotesService, PromissoryNotesRepository],
  exports: [PromissoryNotesService],
})
export class PromissoryNotesModule {}
