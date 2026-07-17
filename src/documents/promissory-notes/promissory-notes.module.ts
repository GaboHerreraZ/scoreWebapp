import { Module } from '@nestjs/common';
import { PromissoryNotesController } from './promissory-notes.controller.js';
import { PromissoryNotesService } from './promissory-notes.service.js';
import { PromissoryNotesRepository } from './promissory-notes.repository.js';
import { ParametersModule } from '../../parameters/parameters.module.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';

/**
 * Documento firmable: pagaré. La integración de firma fue retirada junto con
 * DocuSeal; hoy solo consulta/declina. Al retomar el flujo se reconectará a la
 * capa de firma compartida (SigningModule → Zapsign).
 */
@Module({
  imports: [ParametersModule, NotificationsModule],
  controllers: [PromissoryNotesController],
  providers: [PromissoryNotesService, PromissoryNotesRepository],
  exports: [PromissoryNotesService],
})
export class PromissoryNotesModule {}
