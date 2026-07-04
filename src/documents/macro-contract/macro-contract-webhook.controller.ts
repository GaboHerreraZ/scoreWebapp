import { Controller, Post, Req, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { MacroContractService } from './macro-contract.service.js';
import { ZapsignWebhookPayload } from '../signing/dto/zapsign-webhook.dto.js';

/**
 * Webhooks de Zapsign para el contrato macro. Una URL específica por evento
 * (más claro para configurar en Zapsign y para depurar) en vez de un único
 * endpoint que discrimina por event_type. Todos son @Public() (Zapsign no manda
 * nuestro Bearer) y leen el payload CRUDO: no se confía en él — el service
 * re-consulta el estado real a Zapsign antes de activar nada.
 */
@ApiTags('Zapsign Webhook (Contrato macro)')
@Controller('webhooks/zapsign')
export class MacroContractWebhookController {
  constructor(private readonly service: MacroContractService) {}

  /**
   * Firma completada de un firmante (doc_signed). El documento queda 'signed'
   * solo cuando TODOS firman; el service verifica ese estado real y, si está
   * completo, activa la cuenta y respalda el PDF.
   */
  @Post('doc-signed')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zapsign: documento firmado (doc_signed)' })
  @ApiResponse({ status: 200, description: 'Webhook procesado' })
  async docSigned(@Req() req: Request) {
    const payload = (req.body ?? {}) as ZapsignWebhookPayload;
    await this.service.handleDocSigned(payload);
    return { received: true };
  }

  /**
   * Documento visualizado por un firmante (doc_viewed). Solo telemetría de
   * seguimiento comercial: registra que el cliente abrió el contrato. No afecta
   * el flujo de firma ni la activación de la cuenta.
   */
  @Post('doc-viewed')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zapsign: documento visualizado (doc_viewed)' })
  @ApiResponse({ status: 200, description: 'Webhook procesado' })
  async docViewed(@Req() req: Request) {
    const payload = (req.body ?? {}) as ZapsignWebhookPayload;
    await this.service.handleDocViewed(payload);
    return { received: true };
  }

  /**
   * Documento rechazado por el cliente (doc_refused). Marca el contrato como
   * rechazado con su motivo; la cuenta NO se activa. El contrato queda apto para
   * reenvío (POST /contract/resend) tras corregir con el cliente.
   */
  @Post('doc-refused')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zapsign: documento rechazado (doc_refused)' })
  @ApiResponse({ status: 200, description: 'Webhook procesado' })
  async docRefused(@Req() req: Request) {
    const payload = (req.body ?? {}) as ZapsignWebhookPayload;
    await this.service.handleDocRefused(payload);
    return { received: true };
  }
}
