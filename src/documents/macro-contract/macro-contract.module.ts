import { Module } from '@nestjs/common';
import { MacroContractService } from './macro-contract.service.js';
import { MacroContractRepository } from './macro-contract.repository.js';
import { MacroContractWebhookController } from './macro-contract-webhook.controller.js';
import { MacroContractController } from './macro-contract.controller.js';
import { SigningModule } from '../signing/signing.module.js';

/**
 * Contrato macro Creditia ↔ empresa cliente, firmado vía Zapsign. Expone el
 * webhook público de confirmación de firma y el servicio de orquestación
 * (enviar contrato al confirmarse el pago, activar la cuenta al firmarse).
 * MacroContractService se exporta para que el flujo de pago (AnalysisPacks) lo
 * dispare en el primer pago aprobado.
 */
@Module({
  imports: [SigningModule],
  controllers: [MacroContractWebhookController, MacroContractController],
  providers: [MacroContractService, MacroContractRepository],
  exports: [MacroContractService],
})
export class MacroContractModule {}
