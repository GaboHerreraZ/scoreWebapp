/**
 * Traduce entre el dominio y la forma que espera Aliaddo. Es la ÚNICA pieza que
 * conoce las dos, y por eso la única que hay que reescribir al cambiar de
 * proveedor.
 */
import type {
  BillingContact,
  ProviderAccount,
  ProviderBranch,
  ProviderItem,
  ProviderItemInput,
  ProviderOption,
  ProviderTax,
} from '../domain/billing-catalog.js';
import type {
  InvoiceDocument,
  InvoiceParty,
} from '../domain/invoice-document.js';
import { DIAN_PERSON_TYPE } from '../domain/dian.catalogs.js';
import type {
  EInvoiceProviderStatus,
  EInvoiceResult,
  EInvoiceStatus,
} from '../providers/e-invoice-result.js';
import {
  ALIADDO_BRANCH_ENABLED,
  isDianRejected,
  isDianValid,
  isPercentageRate,
  isVoidedStatus,
  toAliaddoPaymentFormCode,
  toAliaddoPersonKind,
} from './aliaddo.catalogs.js';
import type {
  AliaddoBranch,
  AliaddoChartAccount,
  AliaddoInvoiceRequest,
  AliaddoInvoiceResponse,
  AliaddoItem,
  AliaddoItemCategory,
  AliaddoItemRequest,
  AliaddoMeasuringUnit,
  AliaddoPerson,
  AliaddoPersonRequest,
  AliaddoTax,
} from './aliaddo.types.js';

/** Fecha → 'YYYY-MM-DD'. Aliaddo no acepta el ISO completo en estos campos. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Redondeo a 2 decimales: la DIAN cuadra los totales al centavo. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Factura ───────────────────────────────────────────────────────────────

/**
 * Documento → payload. Es corto a propósito: con esta API la factura solo
 * REFERENCIA maestros (tercero, sucursal, producto, impuesto) que el service ya
 * resolvió. Los importes de línea viajan como string; los totales los calcula
 * Aliaddo y por eso no se envían.
 */
export function toAliaddoInvoice(doc: InvoiceDocument): AliaddoInvoiceRequest {
  const request: AliaddoInvoiceRequest = {
    personId: doc.contactRef,
    // El service garantiza la sucursal antes de llegar aquí: es obligatoria.
    branchId: doc.branchRef ?? '',
    date: toIsoDate(doc.issueDate),
    dueDate: toIsoDate(doc.dueDate),
    paymentFormCode: toAliaddoPaymentFormCode(doc.paymentForm),
    paymentMeanCode: doc.paymentMeanCode,
    currencyCode: doc.currency,
    details: doc.lines.map((line) => ({
      itemCode: line.itemRef,
      quantity: String(line.quantity),
      unitValueBeforeTax: String(money(line.unitPrice)),
      ...(line.description ? { description: line.description } : {}),
      ...(line.taxRefs.length > 0
        ? { taxes: line.taxRefs.map((id) => ({ id })) }
        : {}),
    })),
  };

  // Con la cuenta del recaudo la factura nace pagada en vez de quedar como
  // cartera abierta: el cliente ya pagó antes de que existiera la factura.
  if (doc.paymentAccountCode) {
    request.accountCodePayment = doc.paymentAccountCode;
  }
  if (doc.reference) {
    request.purchaseOrderNumber = doc.reference;
  }
  if (doc.notes.length > 0) {
    request.observation = doc.notes.join(' · ');
  }

  return request;
}

/**
 * Respuesta cruda → resultado de dominio.
 *
 * `raw` se conserva ENTERO: es la evidencia ante la DIAN y ante el cliente, y
 * lo que permite reconstruir qué pasó si el mapeo resulta incompleto.
 */
export function fromAliaddoInvoice(
  httpStatus: number,
  raw: unknown,
): EInvoiceResult {
  const body = (isObject(raw) ? raw : {}) as AliaddoInvoiceResponse;
  const reasons = extractReasons(raw);
  const providerStatus: EInvoiceProviderStatus = {
    document: body.status ?? null,
    dianStage: body.statusDian ?? null,
    dianState: body.stateDian ?? null,
  };

  return {
    status: resolveStatus(httpStatus, body, reasons),
    reasons,
    externalId: body.id ?? null,
    number: body.consecutive ?? null,
    cufe: body.cufe ?? null,
    qrData: body.qr ?? null,
    pdfUrl: body.urlPdf ?? null,
    xmlUrl: body.urlXml ?? null,
    totalAmount: typeof body.totalAmount === 'number' ? body.totalAmount : null,
    providerStatus,
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

  // La anulación se mira ANTES que el veredicto DIAN: una factura anulada sigue
  // teniendo su CUFE de emisión y si no, se leería como aceptada.
  if (isVoidedStatus(body.status)) return 'cancelled';

  if (isDianRejected(body.stateDian)) return 'rejected';

  // Aceptada solo si la DIAN la validó Y hay CUFE: sin huella no hay factura.
  if (isDianValid(body.stateDian) && body.cufe) return 'accepted';

  // 2xx con un estado que no reconocemos (o sin CUFE): ni aceptar ni rechazar
  // a ciegas. Queda pendiente de reconsulta con el motivo archivado.
  return reasons.length > 0 && !body.cufe ? 'rejected' : 'pending';
}

/** Motivos: los de la DIAN, o el error crudo si la llamada falló. */
function extractReasons(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') return [raw];

  const body = raw as AliaddoInvoiceResponse & {
    message?: unknown;
    errors?: unknown;
  };

  if (Array.isArray(body.stateDianReason)) {
    return body.stateDianReason.filter(
      (r): r is string => typeof r === 'string',
    );
  }
  if (typeof body.message === 'string') return [body.message];
  if (Array.isArray(body.errors)) {
    return body.errors.map((e) =>
      typeof e === 'string' ? e : JSON.stringify(e),
    );
  }
  return [];
}

/**
 * Resultado de una anulación. El endpoint devuelve `{}` vacío, así que el
 * desenlace lo dice el HTTP: no hay cuerpo del que sacar estado.
 */
export function fromAliaddoVoid(
  httpStatus: number,
  raw: unknown,
  externalId: string,
): EInvoiceResult {
  const ok = httpStatus >= 200 && httpStatus < 300;
  return {
    status: ok ? 'cancelled' : 'rejected',
    reasons: ok ? [] : extractReasons(raw),
    externalId,
    number: null,
    cufe: null,
    qrData: null,
    pdfUrl: null,
    xmlUrl: null,
    totalAmount: null,
    providerStatus: { document: null, dianStage: null, dianState: null },
    httpStatus,
    raw,
  };
}

// ── Terceros ──────────────────────────────────────────────────────────────

/** Perfil fiscal del adquirente → alta de tercero. */
export function toAliaddoPerson(party: InvoiceParty): AliaddoPersonRequest {
  const isLegalEntity = party.personType === DIAN_PERSON_TYPE.legal;

  const request: AliaddoPersonRequest = {
    kind: toAliaddoPersonKind(isLegalEntity),
    identificationType: party.identificationTypeCode,
    identification: party.identificationNumber,
    // Se da de alta como CLIENTE: sin esto no se le puede facturar.
    isCustomer: true,
  };

  if (party.verificationDigit) {
    request.identificationCheck = party.verificationDigit;
  }
  if (isLegalEntity) {
    request.companyName = party.legalName;
  } else {
    // Aliaddo separa nombres y apellidos; el perfil fiscal solo guarda dos
    // campos, así que el primero de cada par lleva todo lo que haya.
    request.firstName = party.firstName ?? party.legalName;
    request.firstSurname = party.lastName ?? '';
    request.companyName = party.legalName;
  }
  if (party.phone) {
    request.phoneMobile = party.phone;
  }
  if (party.email) {
    request.emails = [{ email: party.email, isMain: true }];
  }

  // La dirección de facturación va con CÓDIGOS DANE (así lo exige para Colombia).
  request.addresses = [
    {
      name: 'Principal',
      address: party.address.address,
      countryCode: party.address.countryCode,
      region: party.address.regionCode,
      city: party.address.cityCode,
      ...(party.address.phone ? { phone: party.address.phone } : {}),
      isForBilling: true,
      isDefault: true,
    },
  ];

  return request;
}

export function fromAliaddoPerson(person: AliaddoPerson): BillingContact {
  const fullName = [
    person.firstName,
    person.secondName,
    person.firstSurname,
    person.secondSurname,
  ]
    .filter((part) => !!part?.trim())
    .join(' ');

  return {
    ref: person.id,
    displayName:
      person.companyName?.trim() || fullName || person.identification,
    identificationTypeCode: person.identificationType,
    identificationNumber: person.identification,
    isLegalEntity: person.kind === 'Company',
    isCustomer: person.isCustomer === true,
    email: mainEmail(person),
    phone: person.phoneMobile || person.phoneWork || null,
  };
}

/** El correo marcado como principal; si ninguno lo está, el primero válido. */
function mainEmail(person: AliaddoPerson): string | null {
  const emails = person.emails ?? [];
  const main = emails.find((e) => e.isMain) ?? emails[0];
  return main?.email ?? null;
}

// ── Impuestos y productos ─────────────────────────────────────────────────

export function fromAliaddoTax(tax: AliaddoTax): ProviderTax {
  return {
    ref: tax.id,
    name: tax.name,
    categoryCode: tax.categoryCode,
    categoryName: tax.categoryName,
    rate: tax.rate,
    isPercentage: isPercentageRate(tax.rateKind),
    includedInPrice: tax.includedInPrice === true,
  };
}

export function fromAliaddoItem(item: AliaddoItem): ProviderItem {
  return {
    ref: item.id,
    code: item.code,
    name: item.name,
    description: item.description ?? null,
    priceSell: typeof item.priceSell === 'number' ? item.priceSell : null,
    taxes: (item.taxes ?? []).map(fromAliaddoTax),
  };
}

export function toAliaddoItem(input: ProviderItemInput): AliaddoItemRequest {
  const request: AliaddoItemRequest = {
    code: input.code,
    name: input.name,
    // Es un servicio: se vende, no se compra ni se inventaría.
    isForSell: true,
    isForBuy: false,
    hasInventoryControl: false,
  };

  if (input.description) request.description = input.description;
  if (input.categoryRef) request.categoryId = input.categoryRef;
  if (input.measuringUnitRef)
    request.unitMeasurementId = input.measuringUnitRef;
  if (input.priceSell != null) request.priceSell = input.priceSell;
  if (input.taxRefs.length > 0) {
    request.taxes = input.taxRefs.map((id) => ({ id }));
  }

  return request;
}

// ── Catálogos de apoyo ────────────────────────────────────────────────────

export function fromAliaddoBranch(branch: AliaddoBranch): ProviderBranch {
  return {
    ref: branch.id,
    name: branch.name,
    isDefault: branch.isDefault === true,
    isEnabled: branch.status === ALIADDO_BRANCH_ENABLED,
    statusLabel: branch.status ?? null,
  };
}

export function fromAliaddoCategory(
  category: AliaddoItemCategory,
): ProviderOption {
  return {
    ref: category.id,
    code: null,
    name: category.name,
    isEnabled: category.enabled !== false,
  };
}

export function fromAliaddoMeasuringUnit(
  unit: AliaddoMeasuringUnit,
): ProviderOption {
  return {
    ref: unit.id,
    code: unit.code,
    name: unit.name,
    isEnabled: unit.enabled !== false,
  };
}

export function fromAliaddoAccount(
  account: AliaddoChartAccount,
): ProviderAccount {
  return { code: account.code, name: account.name };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
