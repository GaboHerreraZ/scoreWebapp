import {
  Controller,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { MacroContractService } from '../documents/macro-contract/macro-contract.service.js';
import { CustomerAuthorizationsService } from '../customer-authorizations/customer-authorizations.service.js';
import { PromissoryNotesService } from '../documents/promissory-notes/promissory-notes.service.js';
import {
  ZapsignWebhookPayload,
  extractDocToken,
} from '../documents/signing/dto/zapsign-webhook.dto.js';

/**
 * Despachador ÚNICO de webhooks de Zapsign. Zapsign es account-wide: manda TODOS
 * los eventos de la cuenta (contrato macro, autorización del titular Y pagaré) a
 * una sola URL. Este controller recibe el evento y lo enruta al handler correcto
 * según el `token` del documento, que es único por tabla:
 *   - está en contract_signatures        → contrato macro
 *   - está en customer_authorizations     → autorización del titular
 *   - está en promissory_notes            → pagaré
 *   - en ninguna                          → se ignora (evento ajeno)
 *
 * Reutiliza las MISMAS rutas que ya estaban configuradas en Zapsign
 * (/webhooks/zapsign/*), así no hay que reconfigurar nada. @Public() porque
 * Zapsign no manda nuestro Bearer; el token no se confía como fuente de verdad
 * (cada service re-consulta el estado real a Zapsign).
 */
@ApiTags('Zapsign Webhook (despachador)')
@Controller('webhooks/zapsign')
export class ZapsignWebhooksController {
  private readonly logger = new Logger(ZapsignWebhooksController.name);

  constructor(
    private readonly macroContract: MacroContractService,
    private readonly authorizations: CustomerAuthorizationsService,
    private readonly promissoryNotes: PromissoryNotesService,
  ) {}

  /** Determina de qué feature es el documento del evento (o null si es ajeno). */
  private async resolveOwner(
    payload: ZapsignWebhookPayload,
  ): Promise<'macro' | 'authorization' | 'promissoryNote' | null> {
    const token = extractDocToken(payload);
    if (!token) return null;
    if (await this.macroContract.ownsDocument(token)) return 'macro';
    if (await this.authorizations.ownsDocument(token)) return 'authorization';
    if (await this.promissoryNotes.ownsDocument(token)) return 'promissoryNote';
    return null;
  }

  @Post('doc-signed')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zapsign: documento firmado (doc_signed)' })
  @ApiResponse({ status: 200, description: 'Webhook procesado' })
  async docSigned(@Req() req: Request) {
    const payload = (req.body ?? {}) as ZapsignWebhookPayload;
    const owner = await this.resolveOwner(payload);
    if (owner === 'macro') {
      await this.macroContract.handleDocSigned(payload);
    } else if (owner === 'authorization') {
      await this.authorizations.handleDocSigned(payload);
    } else if (owner === 'promissoryNote') {
      await this.promissoryNotes.handleDocSigned(payload);
    } else {
      this.logger.warn(
        `doc_signed de token desconocido (${extractDocToken(payload)}); ignorado`,
      );
    }
    return { received: true };
  }

  @Post('doc-refused')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zapsign: documento rechazado (doc_refused)' })
  @ApiResponse({ status: 200, description: 'Webhook procesado' })
  async docRefused(@Req() req: Request) {
    const payload = (req.body ?? {}) as ZapsignWebhookPayload;
    const owner = await this.resolveOwner(payload);
    if (owner === 'macro') {
      await this.macroContract.handleDocRefused(payload);
    } else if (owner === 'authorization') {
      await this.authorizations.handleDocRefused(payload);
    } else if (owner === 'promissoryNote') {
      await this.promissoryNotes.handleDocRefused(payload);
    } else {
      this.logger.warn(
        `doc_refused de token desconocido (${extractDocToken(payload)}); ignorado`,
      );
    }
    return { received: true };
  }

  @Post('doc-viewed')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zapsign: documento visualizado (doc_viewed)' })
  @ApiResponse({ status: 200, description: 'Webhook procesado' })
  async docViewed(@Req() req: Request) {
    const payload = (req.body ?? {}) as ZapsignWebhookPayload;
    // La visualización solo es telemetría del contrato macro; la autorización no
    // la rastrea. Si el doc no es del macro, se ignora.
    if (await this.macroContract.ownsDocument(extractDocToken(payload) ?? '')) {
      await this.macroContract.handleDocViewed(payload);
    }
    return { received: true };
  }
}
