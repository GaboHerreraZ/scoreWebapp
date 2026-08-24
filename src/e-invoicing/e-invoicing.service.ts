import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { EInvoicingRepository } from './e-invoicing.repository.js';
import { FiscalProfileValidator } from './fiscal-profile.validator.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { storedTaxRefs } from './domain/billing-catalog.js';
import {
  E_INVOICE_PROVIDER,
  type IEInvoiceProvider,
} from './providers/e-invoice-provider.interface.js';
import type { EInvoiceResult } from './providers/e-invoice-result.js';
import type { BillingContact } from './domain/billing-catalog.js';
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
import {
  dianPaymentMeanLabel,
  toDianPaymentMean,
  type PaymentMeanResolution,
} from './domain/payment-means.js';
import { toJson } from '../common/utils/prisma-json.util.js';

/** Nombre del impuesto en la línea. Solo se factura IVA por ahora. */
const VAT = { name: 'IVA', code: '01' } as const;

/**
 * Cuánto puede diferir el total del facturador del cobrado antes de considerarlo
 * un descuadre. Un peso cubre el redondeo al centavo; más que eso es que el
 * impuesto configurado allá no es el que se congeló al cobrar.
 */
const TOTAL_TOLERANCE = 1;

type Pack = NonNullable<
  Awaited<ReturnType<EInvoicingRepository['findPackForInvoicing']>>
>;

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
    | 'cancelled' // anulada ante el facturador
    | 'already_invoiced' // ya tenía factura aceptada; no se reemite
    | 'disabled'; // EINVOICE_ENABLED=false: queda registrada, no se envía
  invoiceId: string;
  number: string | null;
  cufe: string | null;
  pdfUrl: string | null;
  reasons: string[];
}

/** Cómo quedó la búsqueda del adquirente en el directorio del facturador. */
export interface ContactResolution {
  status:
    | 'linked' // ya vinculado: se factura contra este
    | 'found' // existe allá pero nadie lo ha vinculado: hay que elegir
    | 'not_found' // no existe: hay que crearlo
    | 'unsupported' // el facturador no admite su tipo de documento
    | 'unavailable'; // no se pudo consultar (red, credenciales)
  /** Ref del tercero cuando ya está vinculado. */
  ref: string | null;
  displayName: string | null;
  /** Candidatos para que el financiero elija. Solo en 'found'. */
  matches: BillingContact[];
  /** Con qué datos se crearía. Solo cuando hay perfil fiscal completo. */
  suggested: InvoiceParty | null;
  /** No impide seguir, pero hay que verlo (ej.: el tercero no es cliente). */
  warnings: string[];
  error: string | null;
}

/** Ítem del catálogo con el que se facturaría esta venta. */
export interface ItemResolution {
  id: string | null;
  code: string | null;
  name: string | null;
  /** Ref del producto en el facturador. Sin esto no se puede emitir. */
  ref: string | null;
  taxRefs: string[];
}

/** Factura ya existente para la venta (rechazada, pendiente o aceptada). */
export interface InvoicePreviewExisting {
  id: string;
  statusCode: string;
  statusLabel: string;
  number: string | null;
  cufe: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  attempts: number;
  lastError: string | null;
  reasons: string[];
  sentAt: Date | null;
  acceptedAt: Date | null;
  voidedAt: Date | null;
}

/**
 * Lo que se va a facturar, ANTES de facturarlo.
 *
 * Sale del mismo armado que usa la emisión (`prepareDraft`), así que lo que se
 * ve aquí es exactamente lo que se envía.
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
  /** El facturador asigna prefijo y consecutivo: aquí no se conocen de antemano. */
  numberedByProvider: true;

  contact: ContactResolution;
  item: ItemResolution;
  branchRef: string | null;
  /** Cuenta del recaudo. null = la factura nacería como cartera abierta. */
  paymentAccountCode: string | null;

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
 */
interface InvoiceDraft {
  pack: Pack;
  existing: Awaited<
    ReturnType<EInvoicingRepository['findByAnalysisPack']>
  > | null;
  contact: ContactResolution;
  item: ItemResolution;
  branchRef: string | null;
  document: InvoiceDocument | null;
  paymentMean: PaymentMeanResolution;
  blockers: string[];
}

@Injectable()
export class EInvoicingService {
  private readonly logger = new Logger(EInvoicingService.name);
  /** Kill switch: en false se registra la factura pero no se envía. */
  private readonly enabled: boolean;
  /**
   * Cuenta contable del recaudo. Con ella la factura nace PAGADA; sin ella queda
   * como cartera abierta en la contabilidad del facturador.
   */
  private readonly paymentAccountCode: string | null;

  constructor(
    private readonly repository: EInvoicingRepository,
    private readonly fiscalProfileValidator: FiscalProfileValidator,
    private readonly platformAdminRepository: PlatformAdminRepository,
    private readonly configService: ConfigService,
    @Inject(E_INVOICE_PROVIDER)
    private readonly provider: IEInvoiceProvider,
  ) {
    this.enabled =
      this.configService.get<string>('EINVOICE_ENABLED', 'false') === 'true';
    this.paymentAccountCode =
      this.configService.get<string>('EINVOICE_PAYMENT_ACCOUNT_CODE') || null;
  }

  /**
   * Cómo está configurado el servidor para facturar. El panel lo necesita para
   * advertir de un ambiente que no sea producción.
   */
  getConfig() {
    return {
      provider: this.provider.name,
      environment: this.provider.environment,
      enabled: this.enabled,
      paymentAccountCode: this.paymentAccountCode,
      // El ambiente lo determina la CUENTA del facturador, no este valor.
      environmentIsDeclared: true,
    };
  }

  // ── Emisión ───────────────────────────────────────────────────────────

  /**
   * Emite la factura de una bolsa ya pagada.
   *
   * Idempotente por venta: si la bolsa ya tiene factura ACEPTADA, no hace nada.
   * Si tiene una rechazada, REUSA la fila (por eso lleva `attempts`) en vez de
   * crear otra.
   */
  async issueForPack(analysisPackId: string): Promise<IssueInvoiceOutcome> {
    const draft = await this.prepareDraft(analysisPackId);
    const { pack, existing } = draft;

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
    if (draft.blockers.length > 0 || !draft.document) {
      throw new BadRequestException(
        `No se puede emitir la factura: ${draft.blockers.join('; ')}`,
      );
    }

    const doc = draft.document;
    const invoiceId =
      existing?.id ??
      (
        await this.repository.create({
          companyId: pack.companyId,
          analysisPackId: pack.id,
          provider: this.provider.name,
          environment: this.provider.environment,
          statusId: await this.statusId('pending'),
          issueDate: doc.issueDate,
          dueDate: doc.dueDate,
          providerContactId: doc.contactRef,
          providerBranchId: doc.branchRef,
          customerSnapshot: toJson(doc.customer),
          linesSnapshot: toJson(doc.lines),
          currencyCode: pack.currencyCode,
          taxBase: doc.totals.amount,
          taxAmount: doc.totals.taxesAmount,
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

    if (draft.paymentMean.isFallback && pack.providerFranchise) {
      this.logger.warn(
        `Franquicia '${pack.providerFranchise}' sin equivalente DIAN; la factura ${invoiceId} ` +
          `va con medio de pago '${draft.paymentMean.code}' (instrumento no definido)`,
      );
    }

    await this.repository.update(invoiceId, {
      statusId: await this.statusId('sending'),
      sentAt: new Date(),
      attempts: { increment: 1 },
      providerContactId: doc.contactRef,
      providerBranchId: doc.branchRef,
      rawRequest: toJson(doc),
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
      this.logger.error(`Fallo enviando la factura ${invoiceId}: ${message}`);
      throw error;
    }

    // El facturador calcula los importes: este es el único número que dice por
    // cuánto se facturó de verdad.
    const mismatch = this.totalMismatch(result, pack.totalPaid);
    if (mismatch) {
      result = { ...result, reasons: [...result.reasons, mismatch] };
      this.logger.error(`Descuadre en la factura ${invoiceId}: ${mismatch}`);
      Sentry.captureMessage(`Factura ${invoiceId}: ${mismatch}`, 'error');
    }

    await this.persistResult(invoiceId, pack.id, result, mismatch);

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
   * Descuadre entre lo cobrado y lo facturado, si lo hay.
   *
   * No se revierte nada: el documento ya está ante la DIAN y corregirlo es una
   * nota crédito. Lo que sí se hace es dejarlo escrito y visible.
   */
  private totalMismatch(
    result: EInvoiceResult,
    totalPaid: number,
  ): string | null {
    if (result.status !== 'accepted' || result.totalAmount === null)
      return null;
    const difference = Math.abs(result.totalAmount - totalPaid);
    if (difference <= TOTAL_TOLERANCE) return null;

    return (
      `El facturador emitió por ${result.totalAmount} y la venta se cobró por ${totalPaid} ` +
      `(diferencia ${difference.toFixed(2)}). Revisa la tarifa del impuesto configurada en el ítem.`
    );
  }

  /**
   * Todos los documentos de una venta, anulados incluidos.
   *
   * Sin esto la anulación desaparecería de la vista: el preview solo muestra la
   * factura viva, y la anulada es justo la que hay que poder mirar después.
   */
  async listDocumentsForPack(analysisPackId: string) {
    const documents = await this.repository.listByAnalysisPack(analysisPackId);
    return documents.map((invoice) => ({
      id: invoice.id,
      statusCode: invoice.status.code,
      statusLabel: invoice.status.label,
      number: invoice.number,
      cufe: invoice.cufe,
      pdfUrl: invoice.pdfUrl,
      xmlUrl: invoice.xmlUrl,
      total: invoice.total,
      environment: invoice.environment,
      attempts: invoice.attempts,
      lastError: invoice.lastError,
      reasons: Array.isArray(invoice.statusReasons)
        ? (invoice.statusReasons as string[])
        : [],
      issueDate: invoice.issueDate,
      sentAt: invoice.sentAt,
      acceptedAt: invoice.acceptedAt,
      voidedAt: invoice.voidedAt,
      voidReason: invoice.voidReason,
      createdAt: invoice.createdAt,
    }));
  }

  /** Reconsulta un documento que quedó sin veredicto. Mismo shape que emitir. */
  async refreshStatus(invoiceId: string): Promise<IssueInvoiceOutcome> {
    const invoice = await this.repository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException(`Factura ${invoiceId} no encontrada`);
    }
    if (!invoice.providerDocumentId) {
      throw new BadRequestException(
        'La factura no llegó a crearse en el facturador: no hay nada que reconsultar. Vuelve a emitirla.',
      );
    }

    const result = await this.provider.getInvoice(invoice.providerDocumentId);
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

  /**
   * Anula una factura ante el facturador y devuelve la venta a la cola.
   *
   * La factura NO se borra: queda con su CUFE, su PDF y el motivo. La DIAN puede
   * preguntar por un documento anulado años después.
   */
  async voidInvoice(
    invoiceId: string,
    reason: string,
    userId: string,
  ): Promise<IssueInvoiceOutcome> {
    const invoice = await this.repository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException(`Factura ${invoiceId} no encontrada`);
    }
    if (invoice.status.code === 'cancelled') {
      throw new BadRequestException('La factura ya está anulada');
    }
    if (!invoice.providerDocumentId) {
      throw new BadRequestException(
        'La factura no existe en el facturador: no hay nada que anular',
      );
    }

    const result = await this.provider.voidInvoice(invoice.providerDocumentId, {
      paymentAccountCode: this.paymentAccountCode,
    });

    if (result.status !== 'cancelled') {
      await this.repository.update(invoiceId, {
        lastError:
          result.reasons[0] ?? 'El facturador no pudo anular la factura',
        rawResponse: toJson(result.raw),
      });
      throw new BadRequestException(
        `No se pudo anular la factura: ${result.reasons.join('; ') || `HTTP ${result.httpStatus}`}`,
      );
    }

    await this.repository.update(invoiceId, {
      statusId: await this.statusId('cancelled'),
      voidedAt: new Date(),
      voidedBy: await this.resolveAdminId(userId),
      voidReason: reason,
      rawResponse: toJson(result.raw),
    });

    // La venta vuelve a la cola: sigue cobrada y sin factura válida.
    if (invoice.analysisPackId) {
      await this.repository.unmarkPackInvoiced(invoice.analysisPackId);
    }

    this.logger.log(
      `Factura ${invoiceId} (${invoice.number}) anulada: ${reason}`,
    );

    return {
      outcome: 'cancelled',
      invoiceId,
      number: invoice.number,
      cufe: invoice.cufe,
      pdfUrl: invoice.pdfUrl,
      reasons: [reason],
    };
  }

  /**
   * Guarda el veredicto y, si fue aceptado, marca la venta como facturada.
   *
   * `mismatch` es lo único que puede dejar en error una factura aceptada. El
   * resto de `reasons` NO va a `lastError` cuando fue aceptada: la DIAN devuelve
   * ahí mensajes informativos ("Procesado Correctamente") y el panel los pintaría
   * como si algo hubiera fallado.
   */
  private async persistResult(
    invoiceId: string,
    analysisPackId: string | null,
    result: EInvoiceResult,
    mismatch: string | null = null,
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
      providerStatus: toJson(result.providerStatus),
      rawResponse: toJson(result.raw),
      acceptedAt: accepted ? new Date() : null,
      lastError: mismatch ?? (accepted ? null : (result.reasons[0] ?? null)),
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

  // ── El adquirente en el directorio del facturador ─────────────────────

  /** Busca en el directorio sin atarlo a ninguna venta (buscador libre). */
  async findContacts(query: {
    identification?: string;
    email?: string;
    phone?: string;
    isLegalEntity?: boolean | null;
  }): Promise<BillingContact[]> {
    if (!query.identification && !query.email && !query.phone) {
      throw new BadRequestException(
        'Indica al menos un criterio: documento, correo o teléfono. El facturador no busca por nombre.',
      );
    }
    return this.provider.findContacts({
      identification: query.identification,
      email: query.email,
      phone: query.phone,
      isLegalEntity: query.isLegalEntity ?? null,
    });
  }

  /** Estado del adquirente de una venta concreta. Lo que alimenta el botón. */
  async resolveContactForPack(
    analysisPackId: string,
  ): Promise<ContactResolution> {
    const pack = await this.repository.findPackForInvoicing(analysisPackId);
    if (!pack) {
      throw new NotFoundException(`Bolsa ${analysisPackId} no encontrada`);
    }
    // Los motivos por los que el perfil fiscal no alcanza los lista el preview;
    // aquí solo interesa con qué datos se crearía el tercero.
    return this.resolveContact(pack, this.buildCustomer(pack.company, []));
  }

  /** Vincula la empresa de la venta con un tercero que ya existe allá. */
  async linkContactForPack(
    analysisPackId: string,
    contactRef: string,
    userId: string,
  ) {
    const pack = await this.repository.findPackForInvoicing(analysisPackId);
    if (!pack) {
      throw new NotFoundException(`Bolsa ${analysisPackId} no encontrada`);
    }

    const identification = pack.company.billingDocNumber?.trim() ?? '';
    // Se confirma contra el facturador en vez de creerle al front: vincular un
    // ref inventado facturaría a otra empresa.
    const matches = await this.provider.findContacts({
      identification,
      isLegalEntity: null,
    });
    const contact = matches.find((candidate) => candidate.ref === contactRef);
    if (!contact) {
      throw new BadRequestException(
        `El tercero seleccionado no corresponde al documento ${identification} de la empresa`,
      );
    }

    await this.repository.upsertContactRef({
      provider: this.provider.name,
      companyId: pack.companyId,
      providerContactId: contact.ref,
      identification: contact.identificationNumber,
      displayName: contact.displayName,
      linkedBy: await this.resolveAdminId(userId),
    });

    this.logger.log(
      `Empresa ${pack.companyId} vinculada al tercero ${contact.ref} (${contact.displayName})`,
    );
    return { companyId: pack.companyId, contact };
  }

  /** Da de alta al adquirente en el facturador y lo deja vinculado. */
  async createContactForPack(analysisPackId: string, userId: string) {
    const pack = await this.repository.findPackForInvoicing(analysisPackId);
    if (!pack) {
      throw new NotFoundException(`Bolsa ${analysisPackId} no encontrada`);
    }

    const blockers: string[] = [];
    const missing = this.fiscalProfileValidator.missingForInvoice(
      pack.company,
      pack.company.billingDocType?.code ?? null,
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `No se puede crear el cliente: faltan datos de facturación de la empresa (${missing.join(', ')})`,
      );
    }

    const party = this.buildCustomer(pack.company, blockers);
    if (!party) {
      throw new BadRequestException(
        `No se puede crear el cliente: ${blockers.join('; ')}`,
      );
    }

    const contact = await this.provider.createContact(party);

    await this.repository.upsertContactRef({
      provider: this.provider.name,
      companyId: pack.companyId,
      providerContactId: contact.ref,
      identification: contact.identificationNumber,
      displayName: contact.displayName,
      linkedBy: await this.resolveAdminId(userId),
    });

    return { companyId: pack.companyId, contact };
  }

  /** userId de Supabase → id del PlatformAdmin, que es lo que auditan las tablas. */
  private async resolveAdminId(userId: string): Promise<string | null> {
    const admin =
      await this.platformAdminRepository.findByUserIdWithRole(userId);
    return admin?.id ?? null;
  }

  /**
   * Resuelve al adquirente sin lanzar: el preview tiene que poder pintar el
   * estado aunque el facturador esté caído.
   *
   * Orden: vínculo guardado (con el MISMO documento) → búsqueda por documento →
   * no existe. El documento es la llave; el facturador no busca por nombre.
   */
  private async resolveContact(
    pack: Pack,
    suggested: InvoiceParty | null,
  ): Promise<ContactResolution> {
    const identification = pack.company.billingDocNumber?.trim() ?? '';

    const base: ContactResolution = {
      status: 'not_found',
      ref: null,
      displayName: null,
      matches: [],
      suggested,
      warnings: [],
      error: null,
    };

    if (!identification) {
      return { ...base, error: 'La empresa no tiene número de documento' };
    }

    const linked = await this.repository.findContactRef(
      this.provider.name,
      pack.companyId,
    );
    if (linked && linked.identification === identification) {
      return {
        ...base,
        status: 'linked',
        ref: linked.providerContactId,
        displayName: linked.displayName,
      };
    }

    const warnings = linked
      ? [
          `La empresa estaba vinculada con el documento ${linked.identification} y ahora factura con ${identification}: hay que volver a vincularla.`,
        ]
      : [];

    let matches: BillingContact[];
    try {
      matches = await this.provider.findContacts({
        identification,
        isLegalEntity: null,
      });
    } catch (error) {
      return {
        ...base,
        status: 'unavailable',
        warnings,
        error: (error as Error).message,
      };
    }

    if (matches.length === 0) {
      // Si no existe hay que crearlo, y para eso el facturador tiene que admitir
      // su tipo de documento. Mejor saberlo aquí que al pulsar "crear".
      const typeCode = suggested?.identificationTypeCode;
      if (typeCode && !this.provider.supportsIdentificationType(typeCode)) {
        return {
          ...base,
          status: 'unsupported',
          warnings,
          error: `El facturador no admite el tipo de documento '${typeCode}' para dar de alta terceros`,
        };
      }
      return { ...base, warnings };
    }

    const notCustomers = matches.filter((contact) => !contact.isCustomer);
    if (notCustomers.length > 0) {
      warnings.push(
        `${notCustomers.length} de los terceros encontrados no está marcado como cliente en el facturador: no se le puede facturar sin corregirlo allá.`,
      );
    }

    return { ...base, status: 'found', matches, warnings };
  }

  // ── Preview ───────────────────────────────────────────────────────────

  /**
   * Qué se va a facturar, sin facturarlo.
   *
   * Se apoya en el MISMO `prepareDraft` que la emisión, así que no puede mostrar
   * una cosa y enviarse otra. No lanza por datos incompletos — los devuelve en
   * `blockers` para que el panel los liste y el admin sepa qué corregir.
   */
  async previewForPack(analysisPackId: string): Promise<InvoicePreview> {
    const draft = await this.prepareDraft(analysisPackId);
    const { pack, existing, document } = draft;

    const warnings = [...draft.contact.warnings];
    if (!this.enabled) {
      warnings.push(
        'La emisión está desactivada (EINVOICE_ENABLED=false): la factura quedará registrada como pendiente, sin enviarse al facturador.',
      );
    }
    if (this.provider.environment !== 'production') {
      warnings.push(
        `El ambiente declarado es '${this.provider.environment}': el documento NO tiene efectos legales ante la DIAN. Ojo: el ambiente real lo define la cuenta del facturador, no esta etiqueta.`,
      );
    }
    if (!this.paymentAccountCode) {
      warnings.push(
        'No hay cuenta de recaudo configurada (EINVOICE_PAYMENT_ACCOUNT_CODE): la factura nacerá como cartera abierta aunque la venta ya esté cobrada.',
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
        `Esta venta ya tiene un documento en estado '${existing.status.label}'. Al emitir se reintenta sobre ese mismo documento.`,
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
      numberedByProvider: true,

      contact: draft.contact,
      item: draft.item,
      branchRef: draft.branchRef,
      paymentAccountCode: this.paymentAccountCode,

      customer: document?.customer ?? draft.contact.suggested,
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
            voidedAt: existing.voidedAt,
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

    const existing = await this.repository.findByAnalysisPack(analysisPackId);
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

    const customer = this.buildCustomer(pack.company, blockers);

    const [contact, branchRef] = await Promise.all([
      this.resolveContact(pack, customer),
      this.resolveBranch(blockers),
    ]);
    const item = this.resolveItem(pack, blockers);

    if (contact.status !== 'linked') {
      blockers.push(contactBlocker(contact));
    }

    const paymentMean = toDianPaymentMean(pack.providerFranchise);

    const canBuild =
      blockers.length === 0 && !!customer && !!pack.paidAt && !!contact.ref;

    if (!canBuild || !customer || !contact.ref || !pack.paidAt) {
      return {
        pack,
        existing,
        contact,
        item,
        branchRef,
        document: null,
        paymentMean,
        blockers,
      };
    }

    const issueDate = pack.paidAt;

    return {
      pack,
      existing,
      contact,
      item,
      branchRef,
      paymentMean,
      blockers,
      document: {
        contactRef: contact.ref,
        branchRef,
        paymentAccountCode: this.paymentAccountCode,
        customer,
        issueDate,
        dueDate: issueDate, // pago de contado: vence el mismo día
        currency: pack.currencyCode,
        paymentForm: 'cash',
        paymentMeanCode: paymentMean.code,
        termDays: 0,
        lines: this.buildLines(pack, item),
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

  /** Sucursal de emisión. Es obligatoria en el payload, así que sin ella no hay factura. */
  private async resolveBranch(blockers: string[]): Promise<string | null> {
    try {
      const ref = await this.provider.resolveDefaultBranchRef();
      if (!ref) {
        blockers.push(
          'el facturador no tiene ninguna sucursal habilitada (o configura ALIADDO_BRANCH_ID)',
        );
      }
      return ref;
    } catch (error) {
      blockers.push(
        `no se pudo consultar la sucursal del facturador: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Ítem con el que se factura la oferta comprada, y la comprobación de que su
   * tarifa de impuesto es la misma que se congeló al cobrar: si no lo es, el
   * facturador emitiría por otro valor.
   */
  private resolveItem(pack: Pack, blockers: string[]): ItemResolution {
    const item = pack.packOffering?.einvoiceItem ?? null;

    if (!item) {
      blockers.push(
        `la oferta '${pack.packOffering?.name ?? 'sin catálogo'}' no tiene un ítem facturable asociado`,
      );
      return { id: null, code: null, name: null, ref: null, taxRefs: [] };
    }
    if (!item.isActive) {
      blockers.push(`el ítem facturable '${item.code}' está desactivado`);
    }
    if (!item.providerItemCode) {
      blockers.push(
        `el ítem facturable '${item.code}' no está sincronizado con el facturador`,
      );
    }

    const paidRate = Number(pack.taxRatePaid ?? 0);
    const itemRate = item.taxRate === null ? null : Number(item.taxRate);
    if (itemRate !== null && Math.abs(itemRate - paidRate) > 0.01) {
      blockers.push(
        `el ítem '${item.code}' está configurado al ${itemRate}% y la venta se cobró con IVA del ${paidRate}%`,
      );
    }
    if (paidRate > 0 && storedTaxRefs(item.providerTaxIds).length === 0) {
      blockers.push(
        `el ítem '${item.code}' no tiene impuesto configurado en el facturador y la venta lleva IVA del ${paidRate}%`,
      );
    }

    return {
      id: item.id,
      code: item.code,
      name: item.name,
      ref: item.providerItemCode,
      taxRefs: storedTaxRefs(item.providerTaxIds),
    };
  }

  // ── Armado del documento ──────────────────────────────────────────────

  /**
   * Adquirente en términos DIAN. Devuelve null y anota el motivo en `blockers`
   * en vez de lanzar: el preview tiene que poder listar TODO lo que falta de
   * una sola pasada, no morirse en el primer campo vacío.
   */
  private buildCustomer(
    company: Pack['company'],
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

  private buildLines(pack: Pack, item: ItemResolution): InvoiceLine[] {
    // La tarifa y el desglose están CONGELADOS en la bolsa desde el cobro: la
    // factura debe emitirse con lo que rigió ese día, no con lo vigente hoy.
    const base = pack.taxBase ?? pack.totalPaid;
    const taxAmount = pack.taxAmount ?? 0;
    const rate = Number(pack.taxRatePaid ?? 0);

    return [
      {
        code: item.code ?? '',
        name: pack.packOffering?.name ?? item.name ?? '',
        description: pack.packOffering?.description ?? null,
        quantity: pack.quantityPurchased,
        // Precio unitario SIN impuestos, derivado de la base congelada.
        unitPrice: base / pack.quantityPurchased,
        unitMeasurementCode:
          pack.packOffering?.einvoiceItem?.unitMeasurementCode ??
          DIAN_UNIT_MEASUREMENT_UNIT,
        taxes: taxAmount > 0 ? [{ ...VAT, rate, base, amount: taxAmount }] : [],
        itemRef: item.ref ?? '',
        taxRefs: taxAmount > 0 ? item.taxRefs : [],
      },
    ];
  }
}

/** Por qué no se puede emitir todavía, según cómo quedó la búsqueda. */
function contactBlocker(contact: ContactResolution): string {
  switch (contact.status) {
    case 'found':
      return `el cliente existe en el facturador pero no está vinculado: selecciona cuál de los ${contact.matches.length} corresponde`;
    case 'not_found':
      return 'el cliente no existe en el facturador: hay que crearlo antes de facturar';
    case 'unsupported':
      return (
        contact.error ?? 'el facturador no admite el documento del cliente'
      );
    case 'unavailable':
      return `no se pudo consultar el directorio del facturador: ${contact.error ?? 'error desconocido'}`;
    default:
      return 'el cliente no está vinculado con el facturador';
  }
}
