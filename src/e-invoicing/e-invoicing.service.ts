import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { EInvoicingRepository } from './e-invoicing.repository.js';
import { FiscalProfileValidator } from './fiscal-profile.validator.js';
import {
  E_INVOICE_PROVIDER,
  type IEInvoiceProvider,
} from './providers/e-invoice-provider.interface.js';
import type { EInvoiceResult } from './providers/e-invoice-result.js';
import type {
  InvoiceDocument,
  InvoiceEnvironment,
  InvoiceLine,
  InvoiceParty,
  InvoiceTotals,
} from './domain/invoice-document.js';
import {
  DIAN_COUNTRY,
  DIAN_DEFAULT_RESPONSIBILITY,
  DIAN_TAX_REGIME,
  DIAN_UNIT_MEASUREMENT_UNIT,
  isLegalEntityDocument,
  toDianIdentificationType,
  toDianPersonType,
} from './domain/dian.catalogs.js';
import { calculateVerificationDigit } from './domain/verification-digit.js';
import { INVOICE_ITEM } from './domain/issuer.constants.js';
import {
  dianPaymentMeanLabel,
  toDianPaymentMean,
  type PaymentMeanResolution,
} from './domain/payment-means.js';
import { toJson } from '../common/utils/prisma-json.util.js';
import type { CreateResolutionDto } from './dto/create-resolution.dto.js';

/** Nombre del impuesto en la línea. Solo se factura IVA por ahora. */
const VAT = { name: 'IVA', code: '01' } as const;

/** La clave técnica es una credencial: en el preview se confirma, no se lee. */
function maskKey(key: string): string {
  return key.length <= 6 ? '••••' : `••••${key.slice(-6)}`;
}

/**
 * Resultado de pulsar "Emitir" en el panel. La emisión es MANUAL: el webhook de
 * pago no factura, solo avisa. Por eso el desenlace tiene que ser explícito —
 * un `null` no le sirve al botón para distinguir "ya estaba facturada" de "el
 * kill switch está apagado".
 */
export interface IssueInvoiceOutcome {
  outcome:
    | 'accepted' // la DIAN la aprobó: hay CUFE y PDF
    | 'rejected' // rechazada; `reasons` dice por qué y se puede reintentar
    | 'pending' // enviada sin veredicto: reconsultar con /refresh
    | 'already_invoiced' // ya tenía factura aceptada; no se reemite
    | 'disabled'; // EINVOICE_ENABLED=false: queda registrada, no se envía
  invoiceId: string;
  number: string | null;
  cufe: string | null;
  pdfUrl: string | null;
  reasons: string[];
}

/** Resolución vigente, tal como se le muestra al admin antes de emitir. */
export interface InvoicePreviewResolution {
  id: string;
  prefix: string;
  number: string;
  /** Enmascarada: sirve para confirmar que está cargada, no para leerla. */
  keyMasked: string;
  rangeInitial: number;
  rangeFinal: number;
  /** El consecutivo que tomaría esta factura. No queda reservado por mirarlo. */
  nextConsecutive: number;
  remaining: number;
  validFrom: Date;
  validUntil: Date;
}

/** Factura ya existente para la venta (rechazada, pendiente o aceptada). */
export interface InvoicePreviewExisting {
  id: string;
  statusCode: string;
  statusLabel: string;
  number: string | null;
  consecutive: number | null;
  cufe: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  attempts: number;
  lastError: string | null;
  reasons: string[];
  sentAt: Date | null;
  acceptedAt: Date | null;
}

/**
 * Lo que se va a facturar, ANTES de facturarlo.
 *
 * Sale del mismo armado que usa la emisión (`prepareDraft`), así que lo que se
 * ve aquí es exactamente lo que se envía — salvo el consecutivo, que solo se
 * reserva al emitir de verdad.
 */
export interface InvoicePreview {
  analysisPackId: string;
  /** false si `blockers` tiene algo: el botón de emitir debe quedar apagado. */
  canIssue: boolean;
  /** Lo que impide emitir. Vacío = listo. */
  blockers: string[];
  /** No impiden emitir, pero el admin debería verlos antes de hacerlo. */
  warnings: string[];

  provider: string;
  environment: InvoiceEnvironment;
  /** Kill switch EINVOICE_ENABLED: en false la factura se registra sin enviar. */
  enabled: boolean;

  resolution: InvoicePreviewResolution | null;
  /** Prefijo + consecutivo que llevaría el documento. */
  documentNumber: string | null;

  customer: InvoiceParty | null;
  lines: InvoiceLine[];
  totals: (InvoiceTotals & { total: number }) | null;

  payment: {
    franchise: string | null;
    meanCode: string;
    meanLabel: string;
    /** true si la franquicia no está mapeada y se cae a "no definido". */
    isFallback: boolean;
    form: 'cash' | 'credit';
    termDays: number;
  };

  issueDate: Date | null;
  dueDate: Date | null;
  currency: string;

  existingInvoice: InvoicePreviewExisting | null;
}

/**
 * Documento armado y listo, o los motivos por los que no se pudo armar.
 * `document` viene sin consecutivo porque reservarlo es un efecto de emitir.
 */
interface InvoiceDraft {
  pack: NonNullable<
    Awaited<ReturnType<EInvoicingRepository['findPackForInvoicing']>>
  >;
  existing: Awaited<
    ReturnType<EInvoicingRepository['findByAnalysisPack']>
  > | null;
  resolution: Awaited<
    ReturnType<EInvoicingRepository['findActiveResolution']>
  > | null;
  document: Omit<InvoiceDocument, 'consecutive'> | null;
  paymentMean: PaymentMeanResolution;
  blockers: string[];
}

@Injectable()
export class EInvoicingService {
  private readonly logger = new Logger(EInvoicingService.name);
  /** Kill switch: en false se registra la factura pero no se envía. */
  private readonly enabled: boolean;

  constructor(
    private readonly repository: EInvoicingRepository,
    private readonly fiscalProfileValidator: FiscalProfileValidator,
    private readonly configService: ConfigService,
    @Inject(E_INVOICE_PROVIDER)
    private readonly provider: IEInvoiceProvider,
  ) {
    this.enabled =
      this.configService.get<string>('EINVOICE_ENABLED', 'false') === 'true';
  }

  /**
   * Emite la factura de una bolsa ya pagada.
   *
   * Idempotente por venta: si la bolsa ya tiene factura ACEPTADA, no hace nada.
   * Si tiene una rechazada, REUSA la fila (por eso lleva `attempts`) en vez de
   * crear otra — un consecutivo quemado no se recicla, pero el documento sí.
   */
  async issueForPack(analysisPackId: string): Promise<IssueInvoiceOutcome> {
    const draft = await this.prepareDraft(analysisPackId);
    const { pack, existing, resolution } = draft;

    if (existing?.status.code === 'accepted') {
      this.logger.log(
        `La bolsa ${analysisPackId} ya tiene factura aceptada (${existing.number}); no se reemite`,
      );
      return {
        outcome: 'already_invoiced',
        invoiceId: existing.id,
        number: existing.number,
        cufe: existing.cufe,
        pdfUrl: existing.pdfUrl,
        reasons: [],
      };
    }

    // Lo que el preview muestra en rojo es lo mismo que aquí corta la emisión:
    // una sola lista de impedimentos, no dos criterios que puedan divergir.
    if (draft.blockers.length > 0 || !draft.document || !resolution) {
      throw new BadRequestException(
        `No se puede emitir la factura: ${draft.blockers.join('; ')}`,
      );
    }

    const { customer, lines, totals, issueDate } = draft.document;
    const invoiceId =
      existing?.id ??
      (
        await this.repository.create({
          companyId: pack.companyId,
          analysisPackId: pack.id,
          provider: this.provider.name,
          environment: this.provider.environment,
          statusId: await this.statusId('pending'),
          resolutionId: resolution.id,
          prefix: resolution.prefix,
          issueDate,
          dueDate: issueDate,
          customerSnapshot: toJson(customer),
          linesSnapshot: toJson(lines),
          currencyCode: pack.currencyCode,
          taxBase: totals.amount,
          taxAmount: totals.taxesAmount,
          total: pack.totalPaid,
        })
      ).id;

    if (!this.enabled) {
      this.logger.warn(
        `EINVOICE_ENABLED=false: la factura ${invoiceId} queda registrada como pendiente, no se envía`,
      );
      return {
        outcome: 'disabled',
        invoiceId,
        number: null,
        cufe: null,
        pdfUrl: null,
        reasons: [
          'La emisión está desactivada (EINVOICE_ENABLED=false). La factura quedó registrada como pendiente.',
        ],
      };
    }

    // El consecutivo se reserva ANTES de llamar al proveedor. Si la llamada
    // falla, ese número queda quemado: la DIAN tolera huecos en la numeración,
    // pero NUNCA duplicados.
    const consecutive = await this.repository.reserveConsecutive(resolution.id);
    if (consecutive === null) {
      const message = `La resolución ${resolution.prefix} agotó su rango autorizado (${resolution.rangeFinal})`;
      await this.repository.update(invoiceId, {
        statusId: await this.statusId('rejected'),
        lastError: message,
      });
      throw new BadRequestException(message);
    }

    if (draft.paymentMean.isFallback && pack.providerFranchise) {
      this.logger.warn(
        `Franquicia '${pack.providerFranchise}' sin equivalente DIAN; la factura ${invoiceId} ` +
          `va con medio de pago '${draft.paymentMean.code}' (instrumento no definido)`,
      );
    }

    const doc: InvoiceDocument = { ...draft.document, consecutive };

    await this.repository.update(invoiceId, {
      consecutive,
      statusId: await this.statusId('sending'),
      sentAt: new Date(),
      attempts: { increment: 1 },
    });

    let result: EInvoiceResult;
    try {
      result = await this.provider.issueInvoice(doc);
    } catch (error) {
      // No se pudo completar la llamada (red, 5xx, credenciales). El documento
      // queda 'sending' con el error: puede haberse creado del otro lado, así
      // que NO se marca rechazado ni se reintenta a ciegas.
      const message = (error as Error).message;
      Sentry.captureException(error);
      await this.repository.update(invoiceId, { lastError: message });
      this.logger.error(
        `Fallo enviando la factura ${invoiceId} (consecutivo ${consecutive}): ${message}`,
      );
      throw error;
    }

    await this.persistResult(invoiceId, pack.id, result);

    return {
      outcome: result.status,
      invoiceId,
      number: result.number,
      cufe: result.cufe,
      pdfUrl: result.pdfUrl,
      reasons: result.reasons,
    };
  }

  /**
   * Qué se va a facturar, sin facturarlo.
   *
   * Se apoya en el MISMO `prepareDraft` que la emisión, así que no puede
   * mostrar una cosa y enviarse otra. Lo único que no ocurre aquí es la reserva
   * del consecutivo: mirar el preview no debe quemar un número.
   *
   * No lanza por datos incompletos — los devuelve en `blockers` para que el
   * panel los liste y el admin sepa qué corregir.
   */
  async previewForPack(analysisPackId: string): Promise<InvoicePreview> {
    const draft = await this.prepareDraft(analysisPackId);
    const { pack, existing, resolution, document } = draft;

    const warnings: string[] = [];
    if (!this.enabled) {
      warnings.push(
        'La emisión está desactivada (EINVOICE_ENABLED=false): la factura quedará registrada como pendiente, sin enviarse al proveedor.',
      );
    }
    if (this.provider.environment !== 'production') {
      warnings.push(
        `El ambiente es '${this.provider.environment}': el documento NO tiene efectos legales ante la DIAN.`,
      );
    }
    if (draft.paymentMean.isFallback) {
      warnings.push(
        `La franquicia '${pack.providerFranchise ?? 'sin dato'}' no tiene equivalente DIAN; se factura como "instrumento no definido".`,
      );
    }
    if (pack.isTest) {
      warnings.push(
        'El pago se registró como transacción de PRUEBA de la pasarela.',
      );
    }
    if (existing && existing.status.code !== 'accepted') {
      warnings.push(
        `Esta venta ya tiene un documento en estado '${existing.status.label}'. Al emitir se reintenta sobre ese mismo documento con un consecutivo nuevo.`,
      );
    }

    return {
      analysisPackId,
      canIssue: draft.blockers.length === 0,
      blockers: draft.blockers,
      warnings,

      provider: this.provider.name,
      environment: this.provider.environment,
      enabled: this.enabled,

      resolution: resolution
        ? {
            id: resolution.id,
            prefix: resolution.prefix,
            number: resolution.number.toString(),
            keyMasked: maskKey(resolution.key),
            rangeInitial: resolution.rangeInitial,
            rangeFinal: resolution.rangeFinal,
            nextConsecutive: resolution.nextConsecutive,
            remaining: Math.max(
              0,
              resolution.rangeFinal - resolution.nextConsecutive + 1,
            ),
            validFrom: resolution.validFrom,
            validUntil: resolution.validUntil,
          }
        : null,
      documentNumber: resolution
        ? `${resolution.prefix}${resolution.nextConsecutive}`
        : null,

      customer: document?.customer ?? null,
      lines: document?.lines ?? [],
      totals: document ? { ...document.totals, total: pack.totalPaid } : null,

      payment: {
        franchise: pack.providerFranchise,
        meanCode: draft.paymentMean.code,
        meanLabel: dianPaymentMeanLabel(draft.paymentMean.code),
        isFallback: draft.paymentMean.isFallback,
        form: 'cash',
        termDays: 0,
      },

      issueDate: document?.issueDate ?? pack.paidAt,
      dueDate: document?.dueDate ?? pack.paidAt,
      currency: pack.currencyCode,

      existingInvoice: existing
        ? {
            id: existing.id,
            statusCode: existing.status.code,
            statusLabel: existing.status.label,
            number: existing.number,
            consecutive: existing.consecutive,
            cufe: existing.cufe,
            pdfUrl: existing.pdfUrl,
            xmlUrl: existing.xmlUrl,
            attempts: existing.attempts,
            lastError: existing.lastError,
            reasons: Array.isArray(existing.statusReasons)
              ? (existing.statusReasons as string[])
              : [],
            sentAt: existing.sentAt,
            acceptedAt: existing.acceptedAt,
          }
        : null,
    };
  }

  /**
   * Arma el documento de una venta y acumula todo lo que impediría emitirlo.
   *
   * Es el único lugar donde se decide qué se factura: preview y emisión lo
   * llaman igual. Solo lanza 404 (la bolsa no existe); el resto de problemas
   * viaja en `blockers` porque el preview necesita listarlos, no morirse.
   */
  private async prepareDraft(analysisPackId: string): Promise<InvoiceDraft> {
    const pack = await this.repository.findPackForInvoicing(analysisPackId);
    if (!pack) {
      throw new NotFoundException(`Bolsa ${analysisPackId} no encontrada`);
    }

    const [existing, resolution] = await Promise.all([
      this.repository.findByAnalysisPack(analysisPackId),
      this.repository.findActiveResolution(this.provider.environment),
    ]);

    const blockers: string[] = [];

    if (!pack.paidAt || pack.totalPaid <= 0) {
      blockers.push(
        'la bolsa no representa un cobro: no hay nada que facturar',
      );
    }

    // El perfil fiscal se validó al comprar, pero pudo editarse después.
    const docTypeCode = pack.company.billingDocType?.code ?? null;
    const missing = this.fiscalProfileValidator.missingForInvoice(
      pack.company,
      docTypeCode,
    );
    if (missing.length > 0) {
      blockers.push(
        `faltan datos de facturación de la empresa (${missing.join(', ')})`,
      );
    }

    if (!resolution) {
      blockers.push(
        `no hay una resolución de facturación vigente para el ambiente '${this.provider.environment}'`,
      );
    } else if (resolution.nextConsecutive > resolution.rangeFinal) {
      blockers.push(
        `la resolución ${resolution.prefix} agotó su rango autorizado (${resolution.rangeFinal})`,
      );
    }

    const customer = this.buildCustomer(pack.company, blockers);
    const paymentMean = toDianPaymentMean(pack.providerFranchise);

    // Sin customer o sin resolución no hay documento que armar; los motivos ya
    // quedaron en blockers.
    if (!customer || !resolution || !pack.paidAt) {
      return {
        pack,
        existing,
        resolution,
        document: null,
        paymentMean,
        blockers,
      };
    }

    const lines = this.buildLines(pack);
    const issueDate = pack.paidAt;

    return {
      pack,
      existing,
      resolution,
      paymentMean,
      blockers,
      document: {
        resolution: {
          key: resolution.key,
          prefix: resolution.prefix,
          number: Number(resolution.number),
          rangeInitial: resolution.rangeInitial,
          rangeFinal: resolution.rangeFinal,
          validFrom: resolution.validFrom,
          validUntil: resolution.validUntil,
        },
        customer,
        issueDate,
        dueDate: issueDate, // pago de contado: vence el mismo día
        currency: pack.currencyCode,
        paymentForm: 'cash',
        paymentMeanCode: paymentMean.code,
        termDays: 0,
        lines,
        totals: {
          amount: pack.taxBase ?? pack.totalPaid,
          taxesAmount: pack.taxAmount ?? 0,
          discountsAmount: 0,
          chargesAmount: 0,
          withholdingAmount: 0,
        },
        notes: [],
        reference: pack.id,
      },
    };
  }

  /** Reconsulta un documento que quedó sin veredicto. Mismo shape que emitir. */
  async refreshStatus(invoiceId: string): Promise<IssueInvoiceOutcome> {
    const invoice = await this.repository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException(`Factura ${invoiceId} no encontrada`);
    }

    const result = await this.provider.getStatus({
      externalId: invoice.providerDocumentId,
      prefix: invoice.prefix,
      consecutive: invoice.consecutive,
    });

    await this.persistResult(invoiceId, invoice.analysisPackId, result);

    return {
      outcome: result.status,
      invoiceId,
      number: result.number,
      cufe: result.cufe,
      pdfUrl: result.pdfUrl,
      reasons: result.reasons,
    };
  }

  /** Guarda el veredicto y, si fue aceptado, marca la venta como facturada. */
  private async persistResult(
    invoiceId: string,
    analysisPackId: string | null,
    result: EInvoiceResult,
  ): Promise<void> {
    const accepted = result.status === 'accepted';

    await this.repository.update(invoiceId, {
      statusId: await this.statusId(result.status),
      providerDocumentId: result.externalId,
      number: result.number,
      cufe: result.cufe,
      qrData: result.qrData,
      pdfUrl: result.pdfUrl,
      xmlUrl: result.xmlUrl,
      statusReasons: toJson(result.reasons),
      rawResponse: toJson(result.raw),
      acceptedAt: accepted ? new Date() : null,
      lastError: accepted ? null : (result.reasons[0] ?? null),
    });

    if (accepted && analysisPackId && result.number) {
      await this.repository.markPackInvoiced(analysisPackId, result.number);
    }
  }

  private async statusId(code: string): Promise<number> {
    const id = await this.repository.findStatusId(code);
    if (!id) {
      throw new BadRequestException(
        `Falta el parámetro einvoice_status '${code}'`,
      );
    }
    return id;
  }

  // ── Resoluciones de facturación ───────────────────────────────────────

  /**
   * Catálogo de resoluciones. `isCurrent` marca la que realmente se usaría hoy:
   * es activa Y del ambiente configurado, que no es lo mismo que estar activa.
   */
  async listResolutions() {
    const resolutions = await this.repository.listResolutions();
    const environment = this.provider.environment;

    return resolutions.map((r) => ({
      id: r.id,
      environment: r.environment,
      // BigInt no se serializa a JSON; además el número de resolución solo se
      // muestra, nunca se opera.
      number: r.number.toString(),
      keyMasked: maskKey(r.key),
      prefix: r.prefix,
      rangeInitial: r.rangeInitial,
      rangeFinal: r.rangeFinal,
      nextConsecutive: r.nextConsecutive,
      remaining: Math.max(0, r.rangeFinal - r.nextConsecutive + 1),
      issued: Math.max(0, r.nextConsecutive - r.rangeInitial),
      validFrom: r.validFrom,
      validUntil: r.validUntil,
      isActive: r.isActive,
      isCurrent: r.isActive && r.environment === environment,
      invoiceCount: r._count.invoices,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Cómo está configurado el servidor para facturar. El panel lo necesita para
   * no dejar registrar una resolución de un ambiente que nunca se va a usar.
   */
  getConfig(): {
    provider: string;
    environment: InvoiceEnvironment;
    enabled: boolean;
  } {
    return {
      provider: this.provider.name,
      environment: this.provider.environment,
      enabled: this.enabled,
    };
  }

  async createResolution(dto: CreateResolutionDto) {
    if (dto.rangeFinal < dto.rangeInitial) {
      throw new BadRequestException(
        'rangeFinal no puede ser menor que rangeInitial',
      );
    }

    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    if (validUntil < validFrom) {
      throw new BadRequestException(
        'validUntil no puede ser anterior a validFrom',
      );
    }

    // Se permite arrancar en medio del rango (facturas ya emitidas por fuera),
    // pero nunca fuera de él: rangeFinal + 1 es el único valor "por encima"
    // válido y significa rango agotado.
    const nextConsecutive = dto.nextConsecutive ?? dto.rangeInitial;
    if (
      nextConsecutive < dto.rangeInitial ||
      nextConsecutive > dto.rangeFinal + 1
    ) {
      throw new BadRequestException(
        `nextConsecutive debe estar entre ${dto.rangeInitial} y ${dto.rangeFinal + 1}`,
      );
    }

    const created = await this.repository.createResolution({
      environment: dto.environment,
      key: dto.key.trim(),
      prefix: dto.prefix.trim().toUpperCase(),
      number: BigInt(dto.number),
      rangeInitial: dto.rangeInitial,
      rangeFinal: dto.rangeFinal,
      nextConsecutive,
      validFrom,
      validUntil,
    });

    this.logger.log(
      `Resolución ${created.prefix} (${dto.environment}) creada: rango ${dto.rangeInitial}-${dto.rangeFinal}, arranca en ${nextConsecutive}`,
    );
    return { id: created.id };
  }

  async setResolutionActive(id: string, isActive: boolean) {
    const resolution = await this.repository.findResolutionById(id);
    if (!resolution) {
      throw new NotFoundException(`Resolución ${id} no encontrada`);
    }
    await this.repository.setResolutionActive(
      id,
      resolution.environment,
      isActive,
    );
    return { id, isActive };
  }

  /**
   * Borra una resolución sin usar. Si ya emitió facturas NO se borra: el
   * documento tiene que poder mostrar bajo qué autorización se expidió, y la
   * DIAN puede pedirlo años después. En ese caso se retira (isActive=false).
   */
  async deleteResolution(id: string) {
    const resolution = await this.repository.findResolutionById(id);
    if (!resolution) {
      throw new NotFoundException(`Resolución ${id} no encontrada`);
    }
    if (resolution._count.invoices > 0) {
      throw new ConflictException(
        `La resolución ${resolution.prefix} ya respalda ${resolution._count.invoices} factura(s) y no se puede borrar. Retírala en su lugar.`,
      );
    }
    await this.repository.deleteResolution(id);
    this.logger.log(`Resolución ${resolution.prefix} (${id}) borrada`);
    return { id, deleted: true };
  }

  // ── Armado del documento ──────────────────────────────────────────────

  /**
   * Adquirente en términos DIAN. Devuelve null y anota el motivo en `blockers`
   * en vez de lanzar: el preview tiene que poder listar TODO lo que falta de
   * una sola pasada, no morirse en el primer campo vacío.
   */
  private buildCustomer(
    company: NonNullable<
      Awaited<ReturnType<EInvoicingRepository['findPackForInvoicing']>>
    >['company'],
    blockers: string[],
  ): InvoiceParty | null {
    const docTypeCode = company.billingDocType?.code ?? null;
    const isLegalEntity = isLegalEntityDocument(docTypeCode);

    const identificationTypeCode = toDianIdentificationType(docTypeCode);
    if (!identificationTypeCode) {
      blockers.push(
        `el tipo de documento '${docTypeCode ?? 'sin definir'}' no tiene equivalente en el catálogo DIAN`,
      );
    }

    const city = company.billingDaneCity;
    if (!city) {
      blockers.push('la empresa no tiene municipio de facturación');
    }

    if (!identificationTypeCode || !city) return null;

    const legalName = isLegalEntity
      ? (company.billingBusinessName ?? company.name)
      : `${company.billingName ?? ''} ${company.billingLastName ?? ''}`.trim();

    return {
      legalName,
      firstName: isLegalEntity ? null : company.billingName,
      lastName: isLegalEntity ? null : company.billingLastName,
      identificationTypeCode,
      identificationNumber: company.billingDocNumber ?? '',
      // El DV solo aplica al NIT; se calcula, no se guarda.
      verificationDigit: isLegalEntity
        ? calculateVerificationDigit(company.billingDocNumber)
        : '',
      personType: toDianPersonType(docTypeCode),
      regimeCode:
        company.billingRegimeType?.code ?? DIAN_TAX_REGIME.notVatResponsible,
      fiscalResponsibilities:
        company.billingFiscalResponsibilities.length > 0
          ? company.billingFiscalResponsibilities
          : [DIAN_DEFAULT_RESPONSIBILITY],
      email: company.billingEmail,
      phone: company.billingPhone,
      address: {
        address: company.billingAddress ?? '',
        countryCode: DIAN_COUNTRY.code,
        countryName: DIAN_COUNTRY.name,
        // El nombre EXACTO del catálogo DIAN, no el normalizado para mostrar:
        // la DIAN valida que corresponda al código.
        cityCode: city.code,
        cityName: city.dianName,
        regionCode: city.regionCode,
        regionName: city.region.name,
        phone: company.billingPhone,
      },
    };
  }

  private buildLines(
    pack: NonNullable<
      Awaited<ReturnType<EInvoicingRepository['findPackForInvoicing']>>
    >,
  ): InvoiceLine[] {
    // La tarifa y el desglose están CONGELADOS en la bolsa desde el cobro: la
    // factura debe emitirse con lo que rigió ese día, no con lo vigente hoy.
    const base = pack.taxBase ?? pack.totalPaid;
    const taxAmount = pack.taxAmount ?? 0;
    const rate = Number(pack.taxRatePaid ?? 0);

    return [
      {
        code: INVOICE_ITEM.code,
        name: pack.packOffering?.name ?? INVOICE_ITEM.name,
        description: pack.packOffering?.description ?? null,
        quantity: pack.quantityPurchased,
        // Precio unitario SIN impuestos, derivado de la base congelada.
        unitPrice: base / pack.quantityPurchased,
        unitMeasurementCode: DIAN_UNIT_MEASUREMENT_UNIT,
        taxes: taxAmount > 0 ? [{ ...VAT, rate, base, amount: taxAmount }] : [],
      },
    ];
  }
}
