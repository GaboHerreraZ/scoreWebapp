import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Error de dominio: la empresa no tiene crédito disponible para consumir. */
export class NoCreditsAvailableError extends ConflictException {
  constructor() {
    super(
      'La empresa no tiene consultas disponibles. Compre una bolsa de análisis para continuar.',
    );
  }
}

/** Datos del comprobante de pago extraídos de la confirmación de ePayco. */
export interface EpaycoReceipt {
  epaycoFranchise?: string | null;
  epaycoCardLast4?: string | null;
  epaycoApprovalCode?: string | null;
  epaycoResponseReason?: string | null;
  paidAt?: Date | null;
  isTest?: boolean;
}

@Injectable()
export class AnalysisPacksRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    status: true,
    packOffering: true,
    consultationPrice: true,
  } as const;

  /** Parameter por type+code (estados de la bolsa). */
  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  /** Datos de facturación de la empresa (para el billing de la sesión ePayco). */
  async findCompanyBilling(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        billingName: true,
        billingLastName: true,
        billingEmail: true,
        billingPhone: true,
        billingAddress: true,
        billingDocNumber: true,
        billingDocTypeId: true,
      },
    });
  }

  /** Guarda el sessionId del checkout v2 en la bolsa. */
  async setEpaycoSessionId(packId: string, sessionId: string) {
    return this.prisma.analysisPack.update({
      where: { id: packId },
      data: { epaycoSessionId: sessionId },
    });
  }

  async create(data: Prisma.AnalysisPackUncheckedCreateInput) {
    return this.prisma.analysisPack.create({
      data,
      include: this.defaultInclude,
    });
  }

  /**
   * Bolsa pendiente de pago de una empresa para una oferta concreta. Sirve para
   * reutilizarla en un reintento de pago (mismo carrito) en vez de crear otra
   * bolsa huérfana. La más reciente primero.
   */
  async findPendingByCompanyAndOffering(
    companyId: string,
    packOfferingId: string,
    pendingStatusId: number,
  ) {
    return this.prisma.analysisPack.findFirst({
      where: { companyId, packOfferingId, statusId: pendingStatusId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Reutiliza una bolsa pendiente en un reintento: recongela el precio vigente,
   * refresca vigencia y deja lista una nueva sesión de ePayco (sessionId se
   * setea aparte). Solo aplica sobre bolsas en pending_payment.
   */
  async refreshPendingPurchase(
    id: string,
    data: {
      quantityPurchased: number;
      startDate: Date;
      endDate: Date;
      unitPricePaid: number;
      totalPaid: number;
      currencyCode: string;
      consultationPriceId: string;
      paymentToken: string;
      // Snapshot del código promocional (o null para limpiar en un reintento
      // que ya no trae código).
      promoCodeId?: string | null;
      promoDiscountPercent?: Prisma.Decimal | null;
      promoDiscountAmount?: number | null;
      promoRedeemedBy?: string | null;
    },
  ) {
    return this.prisma.analysisPack.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async findById(id: string) {
    return this.prisma.analysisPack.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  /**
   * Bolsa por la referencia de ePayco (x_ref_payco, guardada en epaycoRef por el
   * webhook). Para la pantalla de resultado: el front llega con ?ref_payco=... en
   * la URL y consulta por ahí. Más reciente primero por si una referencia se
   * reusara (no debería). Incluye la empresa para validar acceso y pintar.
   */
  async findByEpaycoRef(epaycoRef: string) {
    return this.prisma.analysisPack.findFirst({
      where: { epaycoRef },
      orderBy: { createdAt: 'desc' },
      include: {
        ...this.defaultInclude,
        company: { select: { id: true, name: true, nit: true } },
      },
    });
  }

  /**
   * Bolsa para la pantalla de resultado, resuelta por una referencia flexible:
   * el id propio de la bolsa (UUID, que el front conoce desde el purchase) o
   * el x_ref_payco del webhook. Se prioriza el UUID porque es fiable — el
   * ref_payco de la redirección de ePayco v2 NO coincide con el x_ref_payco del
   * webhook, así que no sirve para cruzar. Incluye la empresa para acceso/recibo.
   */
  async findByReceiptRef(ref: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        ref,
      );
    const include = {
      ...this.defaultInclude,
      company: { select: { id: true, name: true, nit: true } },
    };
    if (isUuid) {
      const byId = await this.prisma.analysisPack.findUnique({
        where: { id: ref },
        include,
      });
      if (byId) return byId;
    }
    // Fallback: por x_ref_payco (compatibilidad con el flujo anterior).
    return this.prisma.analysisPack.findFirst({
      where: { epaycoRef: ref },
      orderBy: { createdAt: 'desc' },
      include,
    });
  }

  /** Bolsas de una empresa (historial), más recientes primero. */
  async findByCompany(companyId: string) {
    return this.prisma.analysisPack.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: this.defaultInclude,
    });
  }

  /**
   * Bolsas de una empresa paginadas (más recientes primero) + total. Solo las
   * procesadas OK por ePayco (excluye los estados pasados en excludeStatusIds:
   * pending_payment y cancelled), es decir activas, agotadas o vencidas por
   * fecha. Trae solo lo necesario: del status el label y de la oferta
   * name/quantity/discountValue (sin consultationPrice).
   */
  async findByCompanyPaginated(params: {
    companyId: string;
    skip: number;
    take: number;
    excludeStatusIds: number[];
  }) {
    const { companyId, skip, take, excludeStatusIds } = params;
    const where = {
      companyId,
      statusId: { notIn: excludeStatusIds },
    };
    const [data, total] = await Promise.all([
      this.prisma.analysisPack.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          status: { select: { label: true, code: true } },
          packOffering: {
            select: { name: true, quantity: true, discountValue: true },
          },
        },
      }),
      this.prisma.analysisPack.count({ where }),
    ]);
    return { data, total };
  }

  /**
   * Eventos de pago de un conjunto de bolsas, SOLO campos seguros (sin payload
   * crudo ni datos sensibles), para mostrar trazabilidad al cliente. Más
   * recientes primero.
   */
  async findPaymentEventsByPackIds(packIds: string[]) {
    if (packIds.length === 0) return [];
    return this.prisma.paymentEvent.findMany({
      where: { analysisPackId: { in: packIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        analysisPackId: true,
        epaycoRef: true,
        codResponse: true,
        responseText: true,
        amount: true,
        currencyCode: true,
        createdAt: true,
      },
    });
  }

  /**
   * Consumos de un conjunto de bolsas, con el detalle del estudio asociado
   * (customer, estado y autor), para agrupar por bolsa (packId). Más recientes
   * primero. Se filtra por packIds para traer solo los de la página de bolsas.
   */
  async findConsumptionsByPackIds(packIds: string[]) {
    if (packIds.length === 0) return [];
    return this.prisma.analysisConsumption.findMany({
      where: { packId: { in: packIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        packId: true,
        creditStudyId: true,
        createdAt: true,
        creditStudy: {
          select: {
            studyDate: true,
            createdBy: true,
            customer: { select: { id: true, businessName: true } },
            status: { select: { label: true, code: true } },
          },
        },
      },
    });
  }

  /**
   * Saldo disponible de una empresa: suma de (purchased − consumed) sobre las
   * bolsas activas y vigentes (endDate >= hoy). Devuelve el total y el detalle
   * de cada bolsa con saldo para que el front muestre vencimientos.
   */
  async findActivePacksWithBalance(companyId: string, activeStatusId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.analysisPack.findMany({
      where: {
        companyId,
        statusId: activeStatusId,
        endDate: { gte: today },
      },
      orderBy: { endDate: 'asc' },
      include: this.defaultInclude,
    });
  }

  /**
   * Variante en lote de findActivePacksWithBalance para VARIAS empresas en una
   * sola query (listado cross-tenant del panel admin). Mismos criterios de
   * vigencia; select mínimo porque solo se necesita el saldo por empresa.
   */
  async findActivePacksWithBalanceForCompanies(
    companyIds: string[],
    activeStatusId: number,
  ) {
    if (companyIds.length === 0) {
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.analysisPack.findMany({
      where: {
        companyId: { in: companyIds },
        statusId: activeStatusId,
        endDate: { gte: today },
      },
      orderBy: { endDate: 'asc' },
      select: {
        id: true,
        companyId: true,
        quantityPurchased: true,
        quantityConsumed: true,
        startDate: true,
        endDate: true,
      },
    });
  }

  /**
   * Registra un evento de pago crudo de ePayco (append-only). Una fila por cada
   * confirmación recibida; conserva el payload completo para auditoría.
   */
  async createPaymentEvent(data: Prisma.PaymentEventUncheckedCreateInput) {
    return this.prisma.paymentEvent.create({ data });
  }

  /**
   * Activa la bolsa tras confirmación de pago exitosa. Sólo pasa de
   * pending_payment → active (claim atómico con updateMany); si otra
   * confirmación concurrente ya la activó, count=0 y no se duplica.
   */
  async activateAfterConfirmation(params: {
    packId: string;
    pendingStatusId: number;
    activeStatusId: number;
    epaycoRef?: string;
    epaycoTransactionId?: string;
    receipt?: EpaycoReceipt;
  }): Promise<boolean> {
    const result = await this.prisma.analysisPack.updateMany({
      where: { id: params.packId, statusId: params.pendingStatusId },
      data: {
        statusId: params.activeStatusId,
        epaycoRef: params.epaycoRef,
        epaycoTransactionId: params.epaycoTransactionId,
        paymentToken: null,
        ...params.receipt,
      },
    });
    return result.count > 0;
  }

  /**
   * Marca el onboarding de una empresa como listo (primer pack pagado). Solo
   * escribe si aún estaba en false, para no tocar filas ni disparar updatedAt en
   * webhooks repetidos. Idempotente.
   */
  async markOnboardingReady(companyId: string): Promise<void> {
    await this.prisma.company.updateMany({
      where: { id: companyId, isOnboardingReady: false },
      data: { isOnboardingReady: true },
    });
  }

  /**
   * Estado de onboarding derivado del pack de una empresa, por PRIORIDAD (no por
   * el más reciente): 'active' gana sobre 'pending_payment'. Cubre la ventana
   * entre que el usuario paga y el webhook confirma, para que el front no ofrezca
   * comprar de nuevo (evita doble compra):
   *   - hasActive  → tiene una bolsa pagada (onboarding listo).
   *   - hasPending → pagó/inició la compra, esperando confirmación del webhook.
   *   - ninguno    → nunca compró (o solo tiene canceladas/vencidas/agotadas).
   * Se filtra por status.type = 'analysis_pack_status' + code para no depender de
   * resolver los ids de parámetro aquí.
   */
  async getOnboardingPackState(
    companyId: string,
  ): Promise<{ hasActive: boolean; hasPending: boolean }> {
    const [activeCount, pendingCount] = await Promise.all([
      this.prisma.analysisPack.count({
        where: {
          companyId,
          status: { type: 'analysis_pack_status', code: 'active' },
        },
      }),
      this.prisma.analysisPack.count({
        where: {
          companyId,
          status: { type: 'analysis_pack_status', code: 'pending_payment' },
        },
      }),
    ]);
    return { hasActive: activeCount > 0, hasPending: pendingCount > 0 };
  }

  /**
   * Cancela una bolsa pendiente de forma DEFINITIVA (abandono/timeout, no un
   * rechazo puntual de tarjeta). Solo aplica si sigue en pending_payment.
   */
  async markCancelled(
    packId: string,
    pendingStatusId: number,
    cancelledStatusId: number,
    epaycoRef?: string,
    epaycoTransactionId?: string,
    receipt?: EpaycoReceipt,
  ): Promise<boolean> {
    const result = await this.prisma.analysisPack.updateMany({
      where: { id: packId, statusId: pendingStatusId },
      data: {
        statusId: cancelledStatusId,
        epaycoRef,
        epaycoTransactionId,
        ...receipt,
      },
    });
    return result.count > 0;
  }

  /**
   * Registra un intento de pago RECHAZADO sin cancelar la bolsa: deja el motivo
   * del último intento y MANTIENE la bolsa en pending_payment, para que un
   * reintento aprobado en el mismo checkout pueda activarla. No toca
   * epaycoRef/epaycoTransactionId (esos son del pago exitoso). Solo actúa si la
   * bolsa sigue pendiente (no pisa una ya activada por una confirmación previa).
   */
  async recordFailedAttempt(
    packId: string,
    pendingStatusId: number,
    responseReason: string | null,
  ): Promise<boolean> {
    const result = await this.prisma.analysisPack.updateMany({
      where: { id: packId, statusId: pendingStatusId },
      data: { epaycoResponseReason: responseReason },
    });
    return result.count > 0;
  }

  /**
   * Regresa una bolsa a pending_payment tras una REVERSA de ePayco (el pago
   * aprobado se devolvió). A diferencia de recordFailedAttempt, actúa sobre una
   * bolsa en cualquier estado (típicamente active) y limpia los datos del pago
   * reversado (refs/sesión) para permitir un nuevo intento. quantityConsumed NO
   * se toca: los estudios ya hechos persisten y el saldo se recalcula al repagar.
   */
  async revertToPending(
    packId: string,
    pendingStatusId: number,
    responseReason: string,
  ): Promise<boolean> {
    const result = await this.prisma.analysisPack.update({
      where: { id: packId },
      data: {
        statusId: pendingStatusId,
        epaycoResponseReason: responseReason,
        epaycoRef: null,
        epaycoTransactionId: null,
        epaycoSessionId: null,
      },
    });
    return !!result;
  }

  /**
   * Consume 1 crédito de la empresa y crea el CreditStudy asociado, TODO en una
   * transacción atómica con lock FIFO para evitar la doble-venta del último
   * crédito (dos estudios concurrentes consumiendo el mismo saldo).
   *
   * Pasos dentro de la transacción:
   *   1. SELECT ... FOR UPDATE de la bolsa consumible más próxima a vencer
   *      (active, vigente, con saldo). El lock serializa los consumos concurrentes.
   *   2. Si no hay → NoCreditsAvailableError (no se crea el estudio).
   *   3. Crea el CreditStudy (vía createStudy, que recibe el tx).
   *   4. Registra el AnalysisConsumption (ledger 1:1 con el estudio).
   *   5. quantityConsumed += 1; si llega al tope → status = depleted.
   *
   * @param createStudy callback que crea el estudio usando el cliente transaccional.
   */
  async consumeCreditForStudy<T extends { id: string }>(params: {
    companyId: string;
    consumedBy: string;
    activeStatusId: number;
    depletedStatusId: number;
    createStudy: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<T> {
    const { companyId, consumedBy, activeStatusId, depletedStatusId } = params;

    return this.prisma.$transaction(async (tx) => {
      // 1. Bolsa consumible con lock (FIFO por endDate). FOR UPDATE serializa
      //    los consumos concurrentes: el segundo espera y relee el saldo.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "analysis_packs"
        WHERE "company_id" = ${companyId}::uuid
          AND "status_id" = ${activeStatusId}
          AND "end_date" >= CURRENT_DATE
          AND "quantity_consumed" < "quantity_purchased"
        ORDER BY "end_date" ASC
        LIMIT 1
        FOR UPDATE
      `;

      const packRow = rows[0];
      if (!packRow) {
        throw new NoCreditsAvailableError();
      }

      // 3. Crear el estudio dentro de la misma transacción.
      const study = await params.createStudy(tx);

      // 4. Registrar el consumo (ledger).
      await tx.analysisConsumption.create({
        data: {
          packId: packRow.id,
          companyId,
          creditStudyId: study.id,
          consumedBy,
        },
      });

      // 5. Incrementar el contador; marcar depleted si se agotó el saldo.
      const updated = await tx.analysisPack.update({
        where: { id: packRow.id },
        data: { quantityConsumed: { increment: 1 } },
        select: { quantityConsumed: true, quantityPurchased: true },
      });
      if (updated.quantityConsumed >= updated.quantityPurchased) {
        await tx.analysisPack.update({
          where: { id: packRow.id },
          data: { statusId: depletedStatusId },
        });
      }

      return study;
    });
  }
}
