import { Module } from '@nestjs/common';
import { PromissoryNotesModule } from './promissory-notes/promissory-notes.module.js';
import { MacroContractModule } from './macro-contract/macro-contract.module.js';

/**
 * Módulo raíz de documentos firmables. Agrupa la capa de firma compartida
 * (signing/) y cada tipo de documento (promissory-notes/, y los que vengan:
 * contratos, autorizaciones, etc.). Cada tipo tiene su propio modelo, controller
 * y rutas bajo companies/:companyId/documents/..., pero comparten el motor de
 * firma (Zapsign) vía SigningModule.
 */
@Module({
  imports: [PromissoryNotesModule, MacroContractModule],
  exports: [MacroContractModule, PromissoryNotesModule],
})
export class DocumentsModule {}
