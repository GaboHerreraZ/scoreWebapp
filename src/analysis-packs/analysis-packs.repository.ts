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

  async create(data: Prisma.AnalysisPackUncheckedCreateInput) {
    return this.prisma.analysisPack.create({
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

  /** Bolsas de una empresa (historial), más recientes primero. */
  async findByCompany(companyId: string) {
    return this.prisma.analysisPack.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: this.defaultInclude,
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

  /** ¿Ya procesamos esta transacción ePayco? (idempotencia del webhook). */
  async existsByTransactionId(transactionId: string): Promise<boolean> {
    const found = await this.prisma.analysisPack.findFirst({
      where: { epaycoTransactionId: transactionId },
      select: { id: true },
    });
    return !!found;
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
  }): Promise<boolean> {
    const result = await this.prisma.analysisPack.updateMany({
      where: { id: params.packId, statusId: params.pendingStatusId },
      data: {
        statusId: params.activeStatusId,
        epaycoRef: params.epaycoRef,
        epaycoTransactionId: params.epaycoTransactionId,
        paymentToken: null,
      },
    });
    return result.count > 0;
  }

  /** Marca la bolsa como cancelada (pago rechazado/fallido del checkout). */
  async markCancelled(
    packId: string,
    pendingStatusId: number,
    cancelledStatusId: number,
    epaycoRef?: string,
    epaycoTransactionId?: string,
  ): Promise<boolean> {
    const result = await this.prisma.analysisPack.updateMany({
      where: { id: packId, statusId: pendingStatusId },
      data: {
        statusId: cancelledStatusId,
        epaycoRef,
        epaycoTransactionId,
      },
    });
    return result.count > 0;
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
