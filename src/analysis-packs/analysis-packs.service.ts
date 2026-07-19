import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AnalysisPacksRepository } from './analysis-packs.repository.js';
import { PackOfferingsRepository } from '../pack-offerings/pack-offerings.repository.js';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { EpaycoService } from '../epayco/epayco.service.js';
import { CompanyAccessRepository } from '../common/auth/company-access.repository.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service.js';
import { PromoCodesService } from '../promo-codes/promo-codes.service.js';
import { MailService } from '../mail/mail.service.js';
import { MacroContractService } from '../documents/macro-contract/macro-contract.service.js';
import { PurchasePackDto } from './dto/purchase-pack.dto.js';
import { PackConfirmationDto } from './dto/pack-confirmation.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import {
  calculatePackPrice,
  type DiscountTypeCode,
} from '../common/utils/pack-pricing.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class AnalysisPacksService {
  private readonly logger = new Logger(AnalysisPacksService.name);

  constructor(
    private readonly repository: AnalysisPacksRepository,
    private readonly packOfferingsRepository: PackOfferingsRepository,
    private readonly consultationPricesService: ConsultationPricesService,
    private readonly epaycoService: EpaycoService,
    private readonly configService: ConfigService,
    private readonly companyAccessRepository: CompanyAccessRepository,
    private readonly platformAdminRepository: PlatformAdminRepository,
    private readonly paymentAlertsService: PaymentAlertsService,
    private readonly promoCodesService: PromoCodesService,
    private readonly mailService: MailService,
    private readonly macroContractService: MacroContractService,
  ) {}

  /**
   * Inicia la compra de un pack: crea la AnalysisPack en pending_payment con el
   * precio CONGELADO y devuelve los datos del checkout onepage de ePayco para
   * que el front abra el widget. La confirmación llega por webhook (no aquí).
   */
  async purchase(companyId: string, dto: PurchasePackDto, userId?: string) {
    const offering = await this.packOfferingsRepository.findById(
      dto.packOfferingId,
    );
    if (!offering || !offering.isActive) {
      throw new NotFoundException(
        'La oferta de bolsa no existe o ya no está disponible',
      );
    }

    const activePrice = await this.consultationPricesService.getActivePrice();
    if (!activePrice) {
      throw new BadRequestException(
        'No hay un precio de consulta activo configurado. No es posible cotizar la compra.',
      );
    }

    // Precio congelado al momento de la compra (derivado del precio vigente).
    const discountTypeCode = offering.discountType?.code as
      | DiscountTypeCode
      | undefined;
    const pricing = calculatePackPrice({
      quantity: offering.quantity,
      unitPrice: activePrice.unitPrice,
      hasDiscount: offering.hasDiscount,
      discountTypeCode,
      discountValue: offering.discountValue,
    });

    // Código promocional OPCIONAL: se valida (sin canjear) y se aplica el % de
    // descuento SOBRE el total ya con descuento por volumen. El canje del cupo
    // ocurre al confirmarse el pago (webhook). Si el código es inválido, se
    // rechaza la compra para que el usuario lo corrija (no se ignora en silencio).
    let promo: {
      promoCodeId: string;
      discountPercent: number;
      discountAmount: number;
    } | null = null;
    let totalToCharge = pricing.total;

    if (dto.promoCode?.trim()) {
      const validation = await this.promoCodesService.validateForPurchase(
        dto.promoCode,
        companyId,
      );
      if (!validation.valid) {
        throw new BadRequestException(
          `Código promocional inválido: ${validation.reason}`,
        );
      }
      const percent = validation.discountPercent!;
      const discountAmount = Math.round(pricing.total * (percent / 100));
      totalToCharge = Math.max(0, pricing.total - discountAmount);
      promo = {
        promoCodeId: validation.promoCodeId!,
        discountPercent: percent,
        discountAmount,
      };
    }

    if (totalToCharge <= 0) {
      throw new BadRequestException(
        'El monto de la compra no es válido para procesar el pago',
      );
    }

    // Vigencia: hoy → hoy + validityDays.
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + offering.validityDays);

    const pendingStatus = await this.repository.findParameterByTypeAndCode(
      'analysis_pack_status',
      'pending_payment',
    );
    if (!pendingStatus) {
      throw new BadRequestException(
        'Falta el parámetro de estado de bolsa (pending_payment)',
      );
    }

    // Datos de facturación de la empresa (ya capturados en el onboarding) para
    // el billing de la sesión de ePayco. Email + nombre son lo mínimo útil.
    const company = await this.repository.findCompanyBilling(companyId);
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const paymentToken = randomBytes(32).toString('hex');

    // 1. La bolsa en pending_payment con el precio CONGELADO. La sesión de ePayco
    //    se crea DESPUÉS, solo si la bolsa quedó guardada OK.
    //    Reintento de pago: si ya existe una bolsa pendiente de esta empresa para
    //    esta misma oferta, se REUTILIZA (recongelando el precio vigente) en vez
    //    de crear otra huérfana. Las pendientes de otras ofertas no se tocan.
    const existingPending =
      await this.repository.findPendingByCompanyAndOffering(
        companyId,
        offering.id,
        pendingStatus.id,
      );

    // Snapshot del código promocional en la bolsa (o null para LIMPIAR si un
    // reintento anterior tenía código y ahora no). totalPaid = lo que se cobra
    // realmente (ya con el descuento del código aplicado).
    const promoSnapshot = {
      promoCodeId: promo?.promoCodeId ?? null,
      promoDiscountPercent: promo
        ? new Prisma.Decimal(promo.discountPercent)
        : null,
      promoDiscountAmount: promo?.discountAmount ?? null,
      promoRedeemedBy: promo ? (userId ?? null) : null,
    };

    const pack = existingPending
      ? await this.repository.refreshPendingPurchase(existingPending.id, {
          quantityPurchased: offering.quantity,
          startDate,
          endDate,
          unitPricePaid: pricing.unitPrice,
          totalPaid: totalToCharge,
          currencyCode: activePrice.currencyCode,
          consultationPriceId: activePrice.id,
          paymentToken,
          ...promoSnapshot,
        })
      : await this.repository.create({
          companyId,
          packOfferingId: offering.id,
          quantityPurchased: offering.quantity,
          quantityConsumed: 0,
          startDate,
          endDate,
          unitPricePaid: pricing.unitPrice,
          totalPaid: totalToCharge,
          currencyCode: activePrice.currencyCode,
          consultationPriceId: activePrice.id,
          statusId: pendingStatus.id,
          paymentToken,
          ...promoSnapshot,
        });

    // invoice = referencia única propia que ePayco devuelve en la confirmación.
    const invoice = `PACK-${pack.id}`;
    const backendUrl = this.configService.get<string>(
      'BACKEND_PUBLIC_URL',
      'http://localhost:3000',
    );
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:4200',
    );

    // El front decide a dónde volver tras el pago (distinto entre onboarding y
    // panel admin). Solo se acepta un path RELATIVO propio del front (debe
    // empezar con "/" y no ser "//", que sería otro dominio → open redirect).
    // Si no llega o es inválido, se usa el default actual.
    const safePath =
      dto.redirectPath &&
      dto.redirectPath.startsWith('/') &&
      !dto.redirectPath.startsWith('//')
        ? dto.redirectPath
        : '/pago/resultado';
    // Anexamos NUESTRA propia referencia (el id de la bolsa) a la URL de retorno.
    // El ref_payco que ePayco añade en la redirección (Checkout v2) NO coincide
    // con el x_ref_payco del webhook, así que es inservible para cruzar. El front
    // debe leer `ref` (no `ref_payco`) y consultar by-reference con ese id.
    const sep = safePath.includes('?') ? '&' : '?';
    const responseUrl = `${frontendUrl}${safePath}${sep}ref=${pack.id}`;

    const billingName = [company.billingName, company.billingLastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    // 2. Crear la sesión de Smart Checkout v2. El sessionId va al front.
    const sessionId = await this.epaycoService.createCheckoutSession({
      invoice,
      amount: totalToCharge,
      name: offering.name,
      description: `${offering.quantity} consultas (análisis de crédito)`,
      currency: activePrice.currencyCode,
      extra1: pack.id, // el webhook lo recibe para identificar la bolsa
      confirmationUrl: `${backendUrl}/api/webhooks/epayco/packs`,
      responseUrl,
      billing: {
        email: company.billingEmail ?? undefined,
        name: billingName || company.name,
        address: company.billingAddress ?? undefined,
        numberDoc: company.billingDocNumber ?? undefined,
        mobilePhone: company.billingPhone ?? undefined,
      },
    });

    // 3. Guardar el sessionId en la bolsa (trazabilidad del intento de pago).
    await this.repository.setEpaycoSessionId(pack.id, sessionId);

    this.logger.log(
      `Empresa ${companyId} inició compra de pack ${pack.id} (oferta ${offering.id}, total ${pricing.total} ${activePrice.currencyCode}, session ${sessionId})`,
    );

    return {
      analysisPackId: pack.id,
      invoice,
      sessionId,
      pricing: {
        quantity: offering.quantity,
        unitPrice: pricing.unitPrice,
        subtotal: pricing.subtotal,
        discountAmount: pricing.discountAmount,
        total: pricing.total,
        currency: activePrice.currencyCode,
      },
      validity: { startDate, endDate },
    };
  }

  /**
   * Consume 1 crédito de la empresa creando el CreditStudy asociado, de forma
   * atómica (lock FIFO anti doble-venta). Resuelve los parámetros de estado y
   * delega la transacción al repositorio. Lanza NoCreditsAvailableError (409)
   * si la empresa no tiene saldo vigente.
   *
   * @param createStudy callback que crea el estudio con el cliente transaccional.
   */
  async consumeCreditForStudy<T extends { id: string }>(params: {
    companyId: string;
    consumedBy: string;
    createStudy: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<T> {
    const [activeStatus, depletedStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode(
        'analysis_pack_status',
        'active',
      ),
      this.repository.findParameterByTypeAndCode(
        'analysis_pack_status',
        'depleted',
      ),
    ]);
    if (!activeStatus || !depletedStatus) {
      throw new BadRequestException('Faltan parámetros de estado de bolsa');
    }

    return this.repository.consumeCreditForStudy({
      companyId: params.companyId,
      consumedBy: params.consumedBy,
      activeStatusId: activeStatus.id,
      depletedStatusId: depletedStatus.id,
      createStudy: params.createStudy,
    });
  }

  /** Bolsas de una empresa (historial). */
  async findByCompany(companyId: string) {
    return this.repository.findByCompany(companyId);
  }

  /** Etiqueta legible del código de respuesta de ePayco (para el cliente). */
  private paymentEventLabel(codResponse: number | null): string {
    switch (codResponse) {
      case 1:
        return 'Aprobada';
      case 2:
        return 'Rechazada';
      case 3:
        return 'Pendiente';
      case 4:
        return 'Fallida';
      case 6:
        return 'Reversada';
      case 7:
        return 'Retenida';
      case 8:
        return 'Iniciada';
      case 9:
        return 'Expirada';
      default:
        return 'Desconocida';
    }
  }

  /**
   * Bolsas de una empresa (paginadas) + sus consumos agrupados por bolsa. Cada
   * consumo trae el detalle del estudio (customer, estado y autor) para que el
   * front muestre "qué se gastó en cada bolsa". También incluye los eventos de
   * pago (paymentEvents) de cada bolsa para trazabilidad de los intentos de
   * cobro. Solo se traen los consumos/eventos de las bolsas de la página actual.
   */
  async getPacksWithConsumptions(companyId: string, filters: PaginationDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    // Se retornan TODAS las bolsas de la empresa, sin importar su estado
    // (active, exhausted, expired, pending_payment, cancelled), para tener
    // trazabilidad completa de todos los intentos.
    const { data: packs, total } =
      await this.repository.findByCompanyPaginated({
        companyId,
        skip,
        take: limit,
        excludeStatusIds: [],
      });

    const packIds = packs.map((p) => p.id);
    const [consumptions, paymentEvents] = await Promise.all([
      this.repository.findConsumptionsByPackIds(packIds),
      this.repository.findPaymentEventsByPackIds(packIds),
    ]);

    // Agrupar los consumos por packId.
    const consumptionsByPack = new Map<string, typeof consumptions>();
    for (const c of consumptions) {
      const list = consumptionsByPack.get(c.packId) ?? [];
      list.push(c);
      consumptionsByPack.set(c.packId, list);
    }

    // Agrupar los eventos de pago por bolsa (analysisPackId no es null aquí, ya
    // que filtramos por packIds existentes).
    const eventsByPack = new Map<string, typeof paymentEvents>();
    for (const e of paymentEvents) {
      const key = e.analysisPackId!;
      const list = eventsByPack.get(key) ?? [];
      list.push(e);
      eventsByPack.set(key, list);
    }

    const toStudy = (c: (typeof consumptions)[number]) => ({
      creditStudyId: c.creditStudyId,
      customerId: c.creditStudy.customer.id,
      customerName: c.creditStudy.customer.businessName,
      statusLabel: c.creditStudy.status.label,
      studyDate: c.creditStudy.studyDate,
      createdBy: c.creditStudy.createdBy,
    });

    const toPaymentEvent = (e: (typeof paymentEvents)[number]) => ({
      date: e.createdAt,
      epaycoRef: e.epaycoRef,
      codResponse: e.codResponse,
      statusLabel: this.paymentEventLabel(e.codResponse),
      responseText: e.responseText,
      amount: e.amount,
      currency: e.currencyCode,
    });

    const data = packs.map((pack) => ({
      ...pack,
      consumptions: (consumptionsByPack.get(pack.id) ?? []).map(toStudy),
      paymentEvents: (eventsByPack.get(pack.id) ?? []).map(toPaymentEvent),
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Estado/recibo de una compra para la pantalla de resultado del pago. La
   * referencia puede ser el id propio de la bolsa (UUID, lo ideal: el front lo
   * conoce desde el purchase) o el x_ref_payco del webhook. Se prefiere el UUID
   * porque el ref_payco que ePayco pone en la URL de redirección (Checkout v2)
   * NO coincide con el x_ref_payco del webhook, así que no sirve para cruzar.
   * El webhook puede tardar unos segundos en activar la bolsa: con el UUID el
   * front puede consultar de una (verá pending_payment y luego active/cancelled).
   * Requiere login y que el usuario tenga acceso a la empresa de la bolsa.
   */
  async getStatusByReference(ref: string, userId: string) {
    const pack = await this.repository.findByReceiptRef(ref);
    if (!pack) {
      throw new NotFoundException('No se encontró una compra con esa referencia');
    }

    // Control de acceso: miembro activo de la empresa, o PlatformAdmin (soporte).
    const isMember = await this.companyAccessRepository.isActiveMember(
      userId,
      pack.companyId,
    );
    if (!isMember) {
      const isAdmin =
        await this.platformAdminRepository.isPlatformAdmin(userId);
      if (!isAdmin) {
        throw new ForbiddenException('No tienes acceso a esta compra');
      }
    }

    return this.buildReceipt(pack);
  }

  /**
   * Arma el "recibo" de una bolsa (empresa, plan, desglose de pago, vigencia)
   * para la pantalla de resultado. El desglose se calcula desde el precio
   * CONGELADO en la bolsa: muestra lo que se pagó, no el catálogo actual.
   */
  private buildReceipt(
    pack: NonNullable<
      Awaited<ReturnType<AnalysisPacksRepository['findByReceiptRef']>>
    >,
  ) {
    const subtotal = pack.unitPricePaid * pack.quantityPurchased;
    const discountAmount = Math.max(0, subtotal - pack.totalPaid);

    return {
      analysisPackId: pack.id,
      status: pack.status.code, // pending_payment | active | cancelled
      statusLabel: pack.status.label,
      invoice: `PACK-${pack.id}`,

      // Empresa para la que se compró (se creó en el onboarding).
      company: {
        id: pack.company.id,
        name: pack.company.name,
        nit: pack.company.nit,
      },

      // Plan / oferta adquirida.
      plan: {
        packOfferingId: pack.packOfferingId,
        name: pack.packOffering?.name ?? null,
        description: pack.packOffering?.description ?? null,
        consultations: pack.quantityPurchased, // nº de consultas adquiridas
        validityDays: pack.packOffering?.validityDays ?? null,
      },

      // Desglose de lo pagado.
      payment: {
        unitPrice: pack.unitPricePaid, // precio por consulta congelado
        subtotal, // unitPrice × consultas (sin descuento)
        discountAmount, // descuento aplicado (>= 0)
        total: pack.totalPaid, // lo que efectivamente se pagó
        currency: pack.currencyCode,
        epaycoRef: pack.epaycoRef,
        epaycoTransactionId: pack.epaycoTransactionId,
      },

      // Vigencia de la bolsa.
      validity: {
        startDate: pack.startDate,
        endDate: pack.endDate,
      },
    };
  }

  /**
   * Saldo de consultas de una empresa: total disponible y detalle de las bolsas
   * activas y vigentes (con su saldo y vencimiento), para que el front lo muestre.
   */
  async getBalance(companyId: string) {
    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'analysis_pack_status',
      'active',
    );
    if (!activeStatus) {
      return { availableCredits: 0, packs: [] };
    }

    const packs = await this.repository.findActivePacksWithBalance(
      companyId,
      activeStatus.id,
    );

    let availableCredits = 0;
    const detail = packs.map((p) => {
      const remaining = p.quantityPurchased - p.quantityConsumed;
      availableCredits += remaining;
      return {
        id: p.id,
        quantityPurchased: p.quantityPurchased,
        quantityConsumed: p.quantityConsumed,
        remaining,
        startDate: p.startDate,
        endDate: p.endDate,
      };
    });

    return { availableCredits, packs: detail };
  }

  /**
   * Procesa la confirmación POST de ePayco para la compra de un pack. Valida
   * firma, idempotencia por transacción, y activa la bolsa si el pago fue
   * aceptado (cod_response=1). El id de la bolsa viaja en x_extra1.
   */
  async handleConfirmation(raw: PackConfirmationDto) {
    // El webhook lee el payload CRUDO (sin DTO/transform), así que ePayco manda
    // varios campos como número (x_ref_payco, x_amount, x_cod_response...). Las
    // columnas y la firma esperan string: normalizamos a string lo que venga.
    const str = (v: unknown): string | undefined =>
      v === undefined || v === null ? undefined : String(v);
    const dto: PackConfirmationDto = {
      ...raw,
      x_ref_payco: str(raw.x_ref_payco),
      x_transaction_id: str(raw.x_transaction_id),
      x_amount: str(raw.x_amount),
      x_currency_code: str(raw.x_currency_code),
      x_signature: str(raw.x_signature),
      x_cod_response: str(raw.x_cod_response),
      x_approval_code: str(raw.x_approval_code),
      x_franchise: str(raw.x_franchise),
      x_cardnumber: str(raw.x_cardnumber),
      x_transaction_date: str(raw.x_transaction_date),
      x_response_reason_text: str(raw.x_response_reason_text),
      x_test_request: str(raw.x_test_request),
      x_extra1: str(raw.x_extra1),
    };

    this.logger.log(
      `Webhook pack recibido: ref=${dto.x_ref_payco}, cod_response=${dto.x_cod_response}, extra1=${dto.x_extra1}`,
    );

    // 1. Validar firma
    const isValid = this.epaycoService.validateConfirmationSignature({
      refPayco: dto.x_ref_payco,
      transactionId: dto.x_transaction_id,
      amount: dto.x_amount,
      currencyCode: dto.x_currency_code,
      signature: dto.x_signature,
    });
    if (!isValid) {
      this.logger.warn(`Firma ePayco inválida para ref=${dto.x_ref_payco}`);
      throw new BadRequestException('Firma inválida');
    }

    // 2. Identificar la bolsa por x_extra1
    const packId = dto.x_extra1;
    if (!packId) {
      throw new BadRequestException('Falta la referencia de la bolsa (extra1)');
    }
    const pack = await this.repository.findById(packId);
    if (!pack) {
      this.logger.warn(`Bolsa no encontrada para extra1=${packId}`);
      throw new NotFoundException(`Bolsa no encontrada (${packId})`);
    }

    // Log crudo del evento (best-effort, append-only). Se guarda el payload
    // ORIGINAL (raw) de ePayco, incluso si luego es un webhook duplicado, para
    // tener trazabilidad completa de todas las confirmaciones recibidas.
    try {
      await this.repository.createPaymentEvent({
        analysisPackId: pack.id,
        companyId: pack.companyId,
        epaycoRef: dto.x_ref_payco,
        epaycoTransactionId: dto.x_transaction_id,
        codResponse: dto.x_cod_response
          ? parseInt(dto.x_cod_response, 10)
          : null,
        responseText: dto.x_response_reason_text ?? dto.x_response ?? null,
        amount: dto.x_amount ? parseFloat(dto.x_amount) : null,
        currencyCode: dto.x_currency_code ?? null,
        isTest: dto.x_test_request?.toUpperCase() === 'TRUE',
        payload: raw as unknown as Prisma.InputJsonValue,
      });
    } catch (e) {
      this.logger.error(
        `No se pudo registrar el PaymentEvent para la bolsa ${pack.id}: ${
          (e as Error).message
        }`,
      );
    }

    // 3. Idempotencia por transacción, ACOTADA A ESTA BOLSA (clave: bolsa + txn).
    //    NO se llavea global por x_transaction_id: en modo test de ePayco ese id
    //    se REPITE entre checkouts distintos (x_ref_payco === x_transaction_id),
    //    así que un check global marcaría como "duplicado" el pago legítimo de
    //    OTRA bolsa y la dejaría sin activar (webhook responde received:true pero
    //    la bolsa queda en pending_payment). La activación en sí ya es atómica
    //    (claim pending→active), por lo que este check solo evita re-ejecutar los
    //    efectos secundarios ante un reenvío del MISMO pago sobre la MISMA bolsa.
    //    Usa el valor ya cargado en `pack` (findById arriba); solo lo habrá puesto
    //    una confirmación previa de esta misma bolsa.
    if (
      dto.x_transaction_id &&
      pack.epaycoTransactionId === dto.x_transaction_id
    ) {
      this.logger.log(
        `Webhook duplicado ignorado para la bolsa ${pack.id}: transacción=${dto.x_transaction_id}`,
      );
      return { received: true };
    }

    const [pendingStatus, activeStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode(
        'analysis_pack_status',
        'pending_payment',
      ),
      this.repository.findParameterByTypeAndCode(
        'analysis_pack_status',
        'active',
      ),
    ]);
    if (!pendingStatus || !activeStatus) {
      throw new BadRequestException('Faltan parámetros de estado de bolsa');
    }

    const responseCode = parseInt(dto.x_cod_response ?? '0', 10);

    // Datos del comprobante (franquicia, tarjeta enmascarada, aprobación, fecha
    // real del cobro, motivo y marca de prueba) para recibo y conciliación.
    const parsedPaidAt = dto.x_transaction_date
      ? new Date(dto.x_transaction_date.replace(' ', 'T'))
      : null;
    const receipt = {
      epaycoFranchise: dto.x_franchise ?? null,
      epaycoCardLast4: dto.x_cardnumber ?? null,
      epaycoApprovalCode: dto.x_approval_code ?? null,
      epaycoResponseReason: dto.x_response_reason_text ?? null,
      paidAt:
        parsedPaidAt && !isNaN(parsedPaidAt.getTime()) ? parsedPaidAt : null,
      isTest: dto.x_test_request?.toUpperCase() === 'TRUE',
    };

    if (responseCode === 1) {
      // Pago aceptado → activar la bolsa (claim atómico pending → active).
      const activated = await this.repository.activateAfterConfirmation({
        packId: pack.id,
        pendingStatusId: pendingStatus.id,
        activeStatusId: activeStatus.id,
        epaycoRef: dto.x_ref_payco,
        epaycoTransactionId: dto.x_transaction_id,
        receipt,
      });
      this.logger.log(
        activated
          ? `Bolsa ${pack.id} ACTIVADA por confirmación de pago (ref=${dto.x_ref_payco})`
          : `Bolsa ${pack.id} ya estaba activada (webhook concurrente, ref=${dto.x_ref_payco})`,
      );

      // Onboarding listo: al confirmarse el pago de una bolsa, la empresa ya
      // tiene perfil + empresa + primer pack activo. Se marca en cada pago
      // aprobado (el repo solo escribe si aún estaba en false → idempotente).
      // Best-effort: un fallo aquí no debe romper el webhook ni la activación.
      try {
        await this.repository.markOnboardingReady(pack.companyId);
      } catch (e) {
        this.logger.error(
          `No se pudo marcar el onboarding como listo para la empresa ${pack.companyId}: ${
            (e as Error).message
          }`,
        );
      }

      // Contrato macro: al confirmarse el pago, la cuenta NO queda activa aún —
      // se envía el contrato macro para firma (Creditia firma por API y el
      // cliente recibe el sign_url). La cuenta se activará cuando el webhook de
      // Zapsign confirme la firma del cliente. sendContractForCompany es
      // idempotente (uno por empresa): en pagos posteriores no reenvía nada.
      // Best-effort: un fallo aquí no debe romper el webhook ni la activación
      // de la bolsa; el contrato queda pendiente y puede reintentarse.
      try {
        await this.macroContractService.sendContractForCompany(pack.companyId);
      } catch (e) {
        this.logger.error(
          `No se pudo enviar el contrato macro para la empresa ${pack.companyId}: ${
            (e as Error).message
          }`,
        );
      }

      // Canje del código promocional: SOLO si esta confirmación fue la que
      // activó la bolsa (activated=true evita canjear dos veces en webhooks
      // concurrentes) y la bolsa traía un código congelado. El canje es atómico
      // (lock + re-validación de cupo). Si el cupo se agotó entre la compra y
      // ahora (oversold), la bolsa YA quedó activa con lo cobrado: se levanta
      // una alerta para gestionarlo. Best-effort: no rompe el webhook.
      if (activated && pack.promoCodeId) {
        try {
          const result = await this.promoCodesService.redeem({
            promoCodeId: pack.promoCodeId,
            companyId: pack.companyId,
            analysisPackId: pack.id,
            redeemedBy: pack.promoRedeemedBy ?? null,
            discountPercent: Number(pack.promoDiscountPercent ?? 0),
            discountAmount: pack.promoDiscountAmount ?? 0,
          });
          if (result.ok) {
            this.logger.log(
              `Código promocional canjeado para la bolsa ${pack.id} (code=${pack.promoCodeId})`,
            );
          } else {
            // No se pudo canjear (agotado, ya usado, vencido...). El pago ya se
            // cobró con descuento; alertamos al admin para conciliar.
            this.logger.warn(
              `No se pudo canjear el código de la bolsa ${pack.id}: ${result.reason}. ` +
                `El pago YA se cobró con descuento — requiere gestión.`,
            );
            await this.paymentAlertsService.createAlert({
              companyId: pack.companyId,
              analysisPackId: pack.id,
              typeCode: 'promo_code_oversold',
              severityCode: 'warning',
              title: 'Cupo de código sobrevendido',
              message:
                `El pago se aprobó con descuento de un código promocional, pero el ` +
                `cupo no pudo canjearse (${result.reason}). La bolsa quedó activa con ` +
                `el monto cobrado; revisar el caso.`,
              metadata: {
                promoCodeId: pack.promoCodeId,
                reason: result.reason,
                discountPercent: Number(pack.promoDiscountPercent ?? 0),
                discountAmount: pack.promoDiscountAmount ?? 0,
                epaycoRef: dto.x_ref_payco ?? null,
              },
            });
          }
        } catch (e) {
          this.logger.error(
            `Error al canjear el código de la bolsa ${pack.id}: ${
              (e as Error).message
            }`,
          );
        }
      }
    } else if (responseCode === 2 || responseCode === 4) {
      // Rechazada (2) / Fallida (4) → NO se cancela: un rechazo de tarjeta no es
      // definitivo, el usuario puede reintentar en el MISMO checkout. La bolsa se
      // queda en pending_payment para que un reintento aprobado la active; solo
      // se registra el motivo (sin pisar epaycoRef/epaycoTransactionId, que son
      // del pago exitoso). La cancelación por abandono se maneja aparte.
      await this.repository.recordFailedAttempt(
        pack.id,
        pendingStatus.id,
        dto.x_response_reason_text ?? null,
      );
      this.logger.warn(
        `Pago de bolsa ${pack.id} rechazado/fallido (código=${responseCode}, ref=${dto.x_ref_payco}); ` +
          `la bolsa sigue pending_payment para permitir reintento`,
      );

      // Alerta SOLO en BD (sin correo): un rechazo aislado no es accionable —
      // el cliente puede reintentar y no hubo cobro. Queda en el panel admin
      // con severidad informativa para detectar patrones de fallos. Best-effort.
      try {
        await this.paymentAlertsService.createAlert({
          companyId: pack.companyId,
          analysisPackId: pack.id,
          typeCode: 'payment_failed',
          severityCode: 'info',
          title: 'Pago rechazado',
          message:
            `Un intento de pago de la bolsa fue ${
              responseCode === 2 ? 'rechazado' : 'fallido'
            }. La bolsa sigue pendiente de pago para que el cliente reintente.`,
          metadata: {
            codResponse: responseCode,
            epaycoRef: dto.x_ref_payco ?? null,
            epaycoTransactionId: dto.x_transaction_id ?? null,
            responseReason: dto.x_response_reason_text ?? null,
            totalPaid: pack.totalPaid,
            currency: pack.currencyCode,
          },
        });
      } catch (e) {
        this.logger.error(
          `No se pudo crear la alerta de pago rechazado para la bolsa ${pack.id}: ${
            (e as Error).message
          }`,
        );
      }
    } else if (responseCode === 6) {
      // Reversada → un pago YA aprobado se devolvió (contracargo/anulación). La
      // bolsa pudo quedar active: la regresamos a pending_payment para que el
      // cliente reintente el pago. quantityConsumed se conserva (los estudios ya
      // hechos no se deshacen): al repagar, el saldo sigue siendo purchased −
      // consumed. Si gastó créditos, el área comercial contacta al cliente.
      const reverted = await this.repository.revertToPending(
        pack.id,
        pendingStatus.id,
        dto.x_response_reason_text ?? 'Pago reversado',
      );
      const consumed = pack.quantityConsumed > 0;
      this.logger.warn(
        `Bolsa ${pack.id} REVERSADA (código=6, ref=${dto.x_ref_payco}); ` +
          `${reverted ? 'devuelta a pending_payment para reintento' : 'sin cambios'}. ` +
          `Consumidos hasta ahora: ${pack.quantityConsumed}/${pack.quantityPurchased}` +
          `${consumed ? ' — REQUIERE GESTIÓN: el cliente ya consumió créditos' : ''}`,
      );

      // Alerta para el panel admin (best-effort: no rompe el webhook). Crítica
      // si el cliente ya consumió créditos del pago reversado.
      try {
        await this.paymentAlertsService.createAlert({
          companyId: pack.companyId,
          analysisPackId: pack.id,
          typeCode: 'payment_reversed',
          severityCode: consumed ? 'critical' : 'warning',
          title: 'Pago reversado',
          message: consumed
            ? `El pago de la bolsa fue reversado y el cliente ya consumió ` +
              `${pack.quantityConsumed} de ${pack.quantityPurchased} consultas. ` +
              `Contactar al cliente para regularizar el pago.`
            : `El pago de la bolsa fue reversado. La bolsa quedó pendiente de pago ` +
              `para que el cliente reintente.`,
          metadata: {
            epaycoRef: dto.x_ref_payco ?? null,
            epaycoTransactionId: dto.x_transaction_id ?? null,
            responseReason: dto.x_response_reason_text ?? null,
            totalPaid: pack.totalPaid,
            currency: pack.currencyCode,
            quantityPurchased: pack.quantityPurchased,
            quantityConsumed: pack.quantityConsumed,
          },
        });
      } catch (e) {
        this.logger.error(
          `No se pudo crear la alerta de reversa para la bolsa ${pack.id}: ${
            (e as Error).message
          }`,
        );
      }

      // Si la bolsa usó un código promocional, se LIBERA el cupo: el pago no
      // quedó firme, así que la promo no debe contar como consumida. Idempotente
      // y best-effort (no rompe el webhook).
      if (pack.promoCodeId) {
        try {
          const released = await this.promoCodesService.release(
            pack.promoCodeId,
            pack.companyId,
          );
          this.logger.log(
            `Reversa bolsa ${pack.id}: cupo de código ${
              released > 0 ? 'liberado' : 'sin canje previo que liberar'
            } (code=${pack.promoCodeId})`,
          );
        } catch (e) {
          this.logger.error(
            `Reversa bolsa ${pack.id}: fallo al liberar el cupo del código: ${
              (e as Error).message
            }`,
          );
        }
      }

      // Correos best-effort (cliente + admins). No bloquean el webhook.
      await this.notifyReversal(pack, consumed);
    } else {
      // Pendiente (3), Iniciada (8), Retenida (7), Expirada (9) u otro → la bolsa
      // se queda en pending_payment esperando una confirmación final; el cliente
      // puede reintentar. No activamos ni cancelamos.
      this.logger.warn(
        `Bolsa ${pack.id} sin confirmación de pago (código=${responseCode}, ref=${dto.x_ref_payco}); ` +
          `sigue pending_payment a la espera de confirmación/reintento`,
      );
    }

    return { received: true };
  }

  /**
   * Notifica una reversa por correo (best-effort): al cliente (debe repagar) y a
   * los admins del portal (incidente a gestionar). Cualquier fallo de envío se
   * loguea pero NO interrumpe el procesamiento del webhook.
   */
  private async notifyReversal(
    pack: NonNullable<
      Awaited<ReturnType<AnalysisPacksRepository['findById']>>
    >,
    consumed: boolean,
  ) {
    const planName = pack.packOffering?.name ?? 'Bolsa de consultas';
    const amount = pack.totalPaid.toLocaleString('es-CO');
    const quantity = String(pack.quantityPurchased);
    const billing = await this.repository.findCompanyBilling(pack.companyId);

    // Correo al cliente (al email de facturación de la empresa).
    try {
      const to = billing?.billingEmail;
      if (to) {
        const customerName =
          [billing?.billingName, billing?.billingLastName]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          billing?.name ||
          'cliente';
        await this.mailService.sendPaymentReversedClientEmail({
          to,
          customerName,
          planName,
          quantity,
          amount,
          currency: pack.currencyCode,
        });
      } else {
        this.logger.warn(
          `Reversa bolsa ${pack.id}: la empresa no tiene billingEmail, no se notificó al cliente`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Reversa bolsa ${pack.id}: fallo al notificar al cliente: ${
          (e as Error).message
        }`,
      );
    }

    // Correo a los admins activos del portal.
    try {
      const adminEmails =
        await this.platformAdminRepository.findActiveAdminEmails();
      const companyName = billing?.name ?? pack.companyId;
      const actionNote = consumed
        ? `El cliente ya consumió ${pack.quantityConsumed} de ${pack.quantityPurchased} ` +
          `consultas: contactarlo para regularizar el pago.`
        : `La bolsa quedó pendiente de pago; el cliente puede reintentar.`;

      await Promise.all(
        adminEmails.map((to) =>
          this.mailService.sendPaymentReversedAdminEmail({
            to,
            companyName,
            planName,
            amount,
            currency: pack.currencyCode,
            consumed: String(pack.quantityConsumed),
            quantity,
            epaycoRef: pack.epaycoRef ?? '—',
            actionNote,
          }),
        ),
      );
    } catch (e) {
      this.logger.error(
        `Reversa bolsa ${pack.id}: fallo al notificar a los admins: ${
          (e as Error).message
        }`,
      );
    }
  }
}
