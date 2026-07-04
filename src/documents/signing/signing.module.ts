import { Module } from '@nestjs/common';
import { DocuSealService } from './docuseal.service.js';
import { DocuSealWebhookGuard } from './guards/docuseal-webhook.guard.js';

/**
 * Capa de firma electrónica compartida por todos los tipos de documento
 * (pagaré, y los que vengan). Envuelve el cliente DocuSeal y su webhook guard.
 * Es agnóstica del tipo de documento: cada módulo de documento la importa para
 * crear submissions y verificar el webhook, sin duplicar la integración.
 */
@Module({
  providers: [DocuSealService, DocuSealWebhookGuard],
  exports: [DocuSealService, DocuSealWebhookGuard],
})
export class SigningModule {}
