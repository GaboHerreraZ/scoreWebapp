/**
 * Traduce entre el dominio y la forma que espera Aliaddo. Es la ÚNICA pieza que
 * conoce las dos, y por eso la única que hay que reescribir al cambiar de
 * proveedor.
 */
import type {
  InvoiceDocument,
  InvoiceEnvironment,
} from '../domain/invoice-document.js';
import { DIAN_TAX_REGIME } from '../domain/dian.catalogs.js';
import type {
  EInvoiceResult,
  EInvoiceStatus,
} from '../providers/e-invoice-result.js';
import {
  ALIADDO_DOCUMENT_CODE_INVOICE,
  ALIADDO_PDF_FORMAT,
  ALIADDO_RESPONSIBLE_FOR_NONE,
  ALIADDO_RESPONSIBLE_FOR_VAT,
  ALIADDO_TAX_TYPE_PERCENT,
  ALIADDO_TYPE_OPERATION_STANDARD,
  isAcceptedStatus,
  isRejectedStatus,
  toAliaddoMode,
  toAliaddoTermDay,
} from './aliaddo.catalogs.js';
import type {
  AliaddoInvoiceRequest,
  AliaddoInvoiceResponse,
} from './aliaddo.types.js';

/** Fecha → 'YYYY-MM-DD'. La DIAN no acepta el ISO completo en estos campos. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Redondeo a 2 decimales: la DIAN cuadra los totales al centavo. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toAliaddoInvoice(
  doc: InvoiceDocument,
  environment: InvoiceEnvironment,
  testSetId: string | null,
): AliaddoInvoiceRequest {
  const mode = toAliaddoMode(environment);

  const request: AliaddoInvoiceRequest = {
    code: ALIADDO_DOCUMENT_CODE_INVOICE,
    typeOperation: ALIADDO_TYPE_OPERATION_STANDARD,
    mode,
    format: ALIADDO_PDF_FORMAT,
    prefix: doc.resolution.prefix,
    consecutive: doc.consecutive,
    currencyCode: doc.currency,
    dueAt: toIsoDate(doc.dueDate),
    paymentMeanCode: doc.paymentMeanCode,
    termDay: toAliaddoTermDay(doc.paymentForm, doc.termDays),

    resolution: {
      key: doc.resolution.key,
      prefix: doc.resolution.prefix,
      number: doc.resolution.number,
      rangeInitial: doc.resolution.rangeInitial,
      rangeFinal: doc.resolution.rangeFinal,
      validFrom: toIsoDate(doc.resolution.validFrom),
      validUntil: toIsoDate(doc.resolution.validUntil),
    },

    customer: {
      companyName: doc.customer.legalName,
      personType: doc.customer.personType,
      regimeType: doc.customer.regimeCode,
      // Aliaddo los exige aunque sean persona jurídica: van vacíos, no ausentes.
      firstName: doc.customer.firstName ?? '',
      lastName: doc.customer.lastName ?? '',
      identification: doc.customer.identificationNumber,
      digitCheck: doc.customer.verificationDigit,
      identificationTypeCode: doc.customer.identificationTypeCode,
      // El catálogo de responsabilidades dice "arreglo" pero el ejemplo del
      // endpoint manda un string. Se envían separadas por ';', que es como
      // Aliaddo documenta las listas en campos de texto (economicActivities).
      responsibilities: doc.customer.fiscalResponsibilities.join(';'),
      responsibleFor:
        doc.customer.regimeCode === DIAN_TAX_REGIME.vatResponsible
          ? ALIADDO_RESPONSIBLE_FOR_VAT
          : ALIADDO_RESPONSIBLE_FOR_NONE,
      ...(doc.customer.email ? { email: doc.customer.email } : {}),
      ...(doc.customer.phone ? { phone: doc.customer.phone } : {}),
      BillingAddress: {
        address: doc.customer.address.address,
        countryCode: doc.customer.address.countryCode,
        countryName: doc.customer.address.countryName,
        regionCode: doc.customer.address.regionCode,
        regionName: doc.customer.address.regionName,
        cityCode: doc.customer.address.cityCode,
        cityName: doc.customer.address.cityName,
        ...(doc.customer.address.phone
          ? { phone: doc.customer.address.phone }
          : {}),
      },
    },

    lines: doc.lines.map((line) => ({
      code: line.code,
      name: line.name,
      ...(line.description ? { description: line.description } : {}),
      unitMeasurementCode: line.unitMeasurementCode,
      price: money(line.unitPrice),
      quantity: line.quantity,
      taxes: line.taxes.map((tax) => ({
        name: tax.name,
        code: tax.code,
        type: ALIADDO_TAX_TYPE_PERCENT,
        rate: tax.rate,
        base: money(tax.base),
        amount: money(tax.amount),
      })),
    })),

    totals: {
      amount: money(doc.totals.amount),
      prepaymentAmount: 0,
      taxesAmount: money(doc.totals.taxesAmount),
      withholdingAmount: money(doc.totals.withholdingAmount),
      discountsAmount: money(doc.totals.discountsAmount),
      chargesAmount: money(doc.totals.chargesAmount),
    },
  };

  // Solo en habilitación: la DIAN entrega un id de set de pruebas.
  if (mode === 'Habilitation' && testSetId) {
    request.testSetId = testSetId;
  }
  if (doc.reference) {
    request.orderReference = doc.reference;
  }
  if (doc.notes.length > 0) {
    request.notes = doc.notes;
  }

  return request;
}

/**
 * Respuesta cruda → resultado de dominio.
 *
 * `raw` se conserva ENTERO: es la evidencia ante la DIAN y ante el cliente, y
 * lo que permite reconstruir qué pasó si el mapeo resulta incompleto.
 */
export function fromAliaddoResponse(
  httpStatus: number,
  raw: unknown,
): EInvoiceResult {
  const body = (raw ?? {}) as AliaddoInvoiceResponse;
  const reasons = extractReasons(raw);

  return {
    status: resolveStatus(httpStatus, body, reasons),
    reasons,
    externalId: body.Id ?? null,
    number: body.Sequence ?? null,
    cufe: body.Cufe ?? null,
    qrData: body.Qr ?? null,
    pdfUrl: body.UrlPdf ?? null,
    xmlUrl: body.UrlXml ?? null,
    httpStatus,
    raw,
  };
}

function resolveStatus(
  httpStatus: number,
  body: AliaddoInvoiceResponse,
  reasons: string[],
): EInvoiceStatus {
  // Un 4xx es rechazo de datos: el documento no existe y hay que corregirlo.
  if (httpStatus >= 400 && httpStatus < 500) return 'rejected';
  // Un 5xx no dice nada del documento: puede haberse creado. Se reconsulta.
  if (httpStatus >= 500) return 'pending';

  if (isRejectedStatus(body.Status)) return 'rejected';

  // Aceptado solo si la DIAN lo aprobó Y hay CUFE: sin huella no hay factura.
  if (isAcceptedStatus(body.Status) && body.Cufe) return 'accepted';

  // 2xx con un estado que no reconocemos (o sin CUFE): ni aceptar ni rechazar
  // a ciegas. Queda pendiente de reconsulta con el motivo archivado.
  return reasons.length > 0 && !body.Cufe ? 'rejected' : 'pending';
}

/** Motivos: los de la DIAN, o el error crudo si la llamada falló. */
function extractReasons(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') return [raw];

  const body = raw as AliaddoInvoiceResponse & {
    message?: unknown;
    errors?: unknown;
  };

  if (Array.isArray(body.StatusReasons)) {
    return body.StatusReasons.filter((r): r is string => typeof r === 'string');
  }
  if (typeof body.message === 'string') return [body.message];
  if (Array.isArray(body.errors)) {
    return body.errors.map((e) =>
      typeof e === 'string' ? e : JSON.stringify(e),
    );
  }
  return [];
}
