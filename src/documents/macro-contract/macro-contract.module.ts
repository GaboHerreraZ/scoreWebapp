import { Module } from '@nestjs/common';
import { MacroContractService } from './macro-contract.service.js';
import { MacroContractRepository } from './macro-contract.repository.js';
import { MacroContractController } from './macro-contract.controller.js';
import { SigningModule } from '../signing/signing.module.js';

/**
 * Contrato macro Creditia ↔ empresa cliente, firmado vía Zapsign. Expone el
 * controller de estado/descarga y el servicio de orquestación (enviar contrato
 * al confirmarse el pago, activar la cuenta al firmarse). Los webhooks de
 * Zapsign los recibe el despachador único (ZapsignWebhooksModule), que enruta
 * por token; por eso MacroContractService se exporta (lo usa el despachador y el
 * flujo de pago en AnalysisPacks).
 */
@Module({
  imports: [SigningModule],
  controllers: [MacroContractController],
  providers: [MacroContractService, MacroContractRepository],
  exports: [MacroContractService],
})
export class MacroContractModule {}
