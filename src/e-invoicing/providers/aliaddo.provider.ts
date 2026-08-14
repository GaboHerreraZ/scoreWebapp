import { Injectable, Logger } from '@nestjs/common';
import { AliaddoClient } from '../aliaddo/aliaddo.client.js';
import {
  fromAliaddoResponse,
  toAliaddoInvoice,
} from '../aliaddo/aliaddo.mapper.js';
import type {
  InvoiceDocument,
  InvoiceEnvironment,
} from '../domain/invoice-document.js';
import type { IEInvoiceProvider } from './e-invoice-provider.interface.js';
import type { EInvoiceRef, EInvoiceResult } from './e-invoice-result.js';

/**
 * Adaptador de Aliaddo (API de integradores: POST /v2/documents/invoices).
 *
 * Solo orquesta client + mapper. No decide nada de negocio: si la DIAN rechaza,
 * lo devuelve como resultado y es el service quien resuelve qué hacer.
 */
@Injectable()
export class AliaddoProvider implements IEInvoiceProvider {
  readonly name = 'aliaddo';
  private readonly logger = new Logger(AliaddoProvider.name);

  constructor(private readonly client: AliaddoClient) {}

  get environment(): InvoiceEnvironment {
    return this.client.environment;
  }

  async issueInvoice(doc: InvoiceDocument): Promise<EInvoiceResult> {
    const payload = toAliaddoInvoice(
      doc,
      this.environment,
      this.client.testSetId,
    );

    const { httpStatus, raw } = await this.client.createInvoice(payload);
    const result = fromAliaddoResponse(httpStatus, raw);

    this.logger.log(
      `Factura ${doc.resolution.prefix}${doc.consecutive} → ${result.status} ` +
        `(HTTP ${httpStatus}${result.cufe ? `, CUFE ${result.cufe.slice(0, 12)}…` : ''})`,
    );

    return result;
  }

  async getStatus(ref: EInvoiceRef): Promise<EInvoiceResult> {
    if (!ref.prefix || ref.consecutive == null) {
      // Sin prefijo/consecutivo no hay forma de consultar en esta API.
      return {
        status: 'pending',
        reasons: ['No hay prefijo y consecutivo para reconsultar el documento'],
        externalId: ref.externalId,
        number: null,
        cufe: null,
        qrData: null,
        pdfUrl: null,
        xmlUrl: null,
        httpStatus: 0,
        raw: null,
      };
    }

    const { httpStatus, raw } =
      await this.client.findInvoiceByPrefixAndConsecutive(
        ref.prefix,
        ref.consecutive,
      );
    return fromAliaddoResponse(httpStatus, raw);
  }
}
