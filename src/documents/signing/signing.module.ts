import { Module } from '@nestjs/common';
import { DocuSealService } from './docuseal.service.js';
import { DocuSealWebhookGuard } from './guards/docuseal-webhook.guard.js';
import { ZapsignService } from './zapsign.service.js';

/**
 * Capa de firma electrónica compartida por todos los tipos de documento
 * (pagaré, contrato macro, y los que vengan). Envuelve los clientes de firma
 * (DocuSeal para pagarés, Zapsign para el contrato macro) y el webhook guard.
 * Es agnóstica del tipo de documento: cada módulo de documento la importa para
 * crear firmas sin duplicar la integración.
 */
@Module({
  providers: [DocuSealService, DocuSealWebhookGuard, ZapsignService],
  exports: [DocuSealService, DocuSealWebhookGuard, ZapsignService],
})
export class SigningModule {}
