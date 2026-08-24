import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Fila del consolidado mes a mes (la arma un GROUP BY en SQL). */
export interface MonthlyCommissionRow {
  month: string; // 'YYYY-MM'
  salesRepId: string;
  salesRepCode: string;
  salesRepName: string | null;
  newCount: number;
  recurringCount: number;
  baseAmount: number;
  commissionAmount: number;
  pendingAmount: number;
  paidAmount: number;
  /** Comisión antes de restarle los descuentos que él mismo otorgó. */
  grossCommissionAmount: number;
  /** Lo que financió de su bolsillo vía sus códigos promocionales. */
  discountFundedAmount: number;
}

@Injectable()
export class SalesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Vendedor + su cuenta del portal (nombre/correo son de PlatformAdmin: aquí
  // no se duplican datos personales).
  private readonly repInclude = {
    platformAdmin: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        role: { select: { code: true, label: true } },
      },
    },
    _count: { select: { referrals: true } },
  } as const;

  private readonly referralInclude = {
    salesRep: { include: this.repInclude },
    company: { select: { id: true, name: true, nit: true } },
    commissionPlan: { select: { id: true, name: true } },
  } as const;

  // ── Parámetros ────────────────────────────────────────────────────────

  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  async findCommissionStatuses() {
    return this.prisma.parameter.findMany({
      where: { type: 'sales_commission_status', isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, label: true },
    });
  }

  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        role: { select: { code: true, label: true } },
        salesRep: { select: { id: true, code: true, isActive: true } },
      },
    });
  }

  async findPlatformAdminById(id: string) {
    return this.prisma.platformAdmin.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        lastName: true, // el código sugerido usa nombre + apellido
        email: true,
        isActive: true,
        role: { select: { code: true, label: true } },
      },
    });
  }

  // ── Plan de comisiones ────────────────────────────────────────────────

  /** Plan vigente. null si nunca se configuró uno. */
  async findActivePlan() {
    return this.prisma.commissionPlan.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPlans() {
    return this.prisma.commissionPlan.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdByAdmin: { select: { id: true, name: true, email: true } },
        _count: { select: { referrals: true, commissions: true } },
      },
    });
  }

  /**
   * Publica una versión nueva del plan: desactiva la vigente y crea la nueva en
   * una sola transacción, para que nunca haya dos activas ni un hueco sin plan.
   */
  async publishPlan(data: Prisma.CommissionPlanUncheckedCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.commissionPlan.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.commissionPlan.create({ data: { ...data, isActive: true } });
    });
  }

  // ── Vendedores ────────────────────────────────────────────────────────

  async createRep(data: Prisma.SalesRepUncheckedCreateInput) {
    return this.prisma.salesRep.create({
      data,
      include: this.repInclude,
    });
  }

  async findReps(onlyActive = false) {
    return this.prisma.salesRep.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
      include: this.repInclude,
    });
  }

  async findRepById(id: string) {
    return this.prisma.salesRep.findUnique({
      where: { id },
      include: this.repInclude,
    });
  }

  async findRepByCode(code: string) {
    return this.prisma.salesRep.findUnique({
      where: { code },
      include: this.repInclude,
    });
  }

  async findRepByPlatformAdminId(platformAdminId: string) {
    return this.prisma.salesRep.findUnique({
      where: { platformAdminId },
      include: this.repInclude,
    });
  }

  async updateRep(id: string, data: Prisma.SalesRepUncheckedUpdateInput) {
    return this.prisma.salesRep.update({
      where: { id },
      data,
      include: this.repInclude,
    });
  }

  /**
   * Rastro que deja un vendedor. Decide si se puede borrar de verdad o solo
   * retirar: empresas vinculadas o comisiones causadas son historia que no se
   * puede perder, y sus códigos con canjes ya afectaron ventas reales.
   */
  async countRepFootprint(salesRepId: string) {
    const [referrals, commissions, promoCodes, redeemedCodes] =
      await Promise.all([
        this.prisma.companyReferral.count({ where: { salesRepId } }),
        this.prisma.salesCommission.count({ where: { salesRepId } }),
        this.prisma.promoCode.count({ where: { salesRepId } }),
        this.prisma.promoCode.count({
          where: { salesRepId, redemptionsCount: { gt: 0 } },
        }),
      ]);
    return { referrals, commissions, promoCodes, redeemedCodes };
  }

  /**
   * Borra el vendedor junto con sus códigos SIN canjear. Solo lo llama el
   * service tras comprobar que no deja huella; los códigos van en la misma
   * transacción porque la FK es RESTRICT y si no, el delete rebota.
   */
  async deleteRep(salesRepId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.promoCode.deleteMany({ where: { salesRepId } });
      await tx.salesRep.delete({ where: { id: salesRepId } });
    });
  }

  /**
   * Apaga los códigos activos de un vendedor retirado. Devuelve cuántos. Sin
   * esto, un cliente podría redimir el descuento de alguien que ya no está en el
   * programa y la comisión quedaría a nombre de un vendedor inactivo.
   */
  async deactivateRepPromoCodes(salesRepId: string): Promise<number> {
    const result = await this.prisma.promoCode.updateMany({
      where: { salesRepId, isActive: true },
      data: { isActive: false },
    });
    return result.count;
  }

  // ── Vinculación empresa ↔ vendedor ────────────────────────────────────

  async findReferralByCompany(companyId: string) {
    return this.prisma.companyReferral.findUnique({
      where: { companyId },
      include: this.referralInclude,
    });
  }

  async findReferralsByRep(salesRepId: string) {
    return this.prisma.companyReferral.findMany({
      where: { salesRepId },
      orderBy: { createdAt: 'desc' },
      include: this.referralInclude,
    });
  }

  /** Vincula o reasigna (la PK es companyId: una empresa, un vendedor). */
  async upsertReferral(data: {
    companyId: string;
    salesRepId: string;
    commissionPlanId: string;
    newCustomerPercent: Prisma.Decimal;
    recurringPercent: Prisma.Decimal;
    assignedBy: string | null;
    notes: string | null;
  }) {
    const { companyId, ...rest } = data;
    return this.prisma.companyReferral.upsert({
      where: { companyId },
      create: { companyId, ...rest },
      // Reasignar NO reescribe los % ya congelados salvo que cambie el plan:
      // se toman los del payload, que el service resuelve del plan vigente.
      update: rest,
      include: this.referralInclude,
    });
  }

  async deleteReferral(companyId: string) {
    return this.prisma.companyReferral.delete({ where: { companyId } });
  }

  async countCommissionsByCompany(companyId: string) {
    return this.prisma.salesCommission.count({ where: { companyId } });
  }

  async findCompanyById(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      // createdAt: ancla de la ventana para asignar vendedor.
      select: { id: true, name: true, nit: true, createdAt: true },
    });
  }

  // ── Ledger de comisiones ──────────────────────────────────────────────

  private readonly commissionInclude = {
    company: { select: { id: true, name: true, nit: true } },
    salesRep: {
      select: {
        id: true,
        code: true,
        platformAdmin: { select: { name: true, email: true } },
      },
    },
    status: { select: { id: true, code: true, label: true } },
    analysisPack: {
      select: {
        id: true,
        quantityPurchased: true,
        totalPaid: true,
        paidAt: true,
        einvoiceNumber: true,
      },
    },
  } as const;

  async findCommissionByPack(analysisPackId: string) {
    return this.prisma.salesCommission.findUnique({
      where: { analysisPackId },
    });
  }

  async createCommission(data: Prisma.SalesCommissionUncheckedCreateInput) {
    return this.prisma.salesCommission.create({ data });
  }

  async findCommissionById(id: string) {
    return this.prisma.salesCommission.findUnique({
      where: { id },
      include: {
        ...this.commissionInclude,
        // Para poder decir en qué giro se pagó si se intenta editar suelta.
        payout: { select: { id: true, reference: true } },
      },
    });
  }

  async updateCommission(
    id: string,
    data: Prisma.SalesCommissionUncheckedUpdateInput,
  ) {
    return this.prisma.salesCommission.update({
      where: { id },
      data,
      include: this.commissionInclude,
    });
  }

  async findCommissions(params: {
    skip: number;
    take: number;
    where: Prisma.SalesCommissionWhereInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.salesCommission.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { accruedAt: 'desc' },
        include: this.commissionInclude,
      }),
      this.prisma.salesCommission.count({ where: params.where }),
    ]);
    return { data, total };
  }

  /** Totales de un filtro (para la cabecera del listado). */
  async sumCommissions(where: Prisma.SalesCommissionWhereInput) {
    const result = await this.prisma.salesCommission.aggregate({
      where,
      _sum: {
        commissionAmount: true,
        baseAmount: true,
        grossCommissionAmount: true,
        discountFundedAmount: true,
      },
      _count: true,
    });
    return {
      count: result._count,
      baseAmount: result._sum.baseAmount ?? 0,
      commissionAmount: result._sum.commissionAmount ?? 0,
      grossCommissionAmount: result._sum.grossCommissionAmount ?? 0,
      discountFundedAmount: result._sum.discountFundedAmount ?? 0,
    };
  }

  /**
   * ¿Cuántas compras facturadas tuvo la empresa ANTES de esta? 0 = es la primera
   * y causa el % de cliente nuevo. Se mira sobre las bolsas pagadas con costo
   * (no sobre las comisiones): así una empresa vinculada tarde, que ya venía
   * comprando, no dispara el bono de cliente nuevo.
   *
   * La comparación es estrictamente por fecha de pago, no "todas las demás":
   * al causar comisiones hacia atrás se recorren varias bolsas y la más antigua
   * debe verse a sí misma como la primera. El desempate por id cubre el caso
   * (teórico) de dos pagos con el mismo timestamp: solo una puede ser la primera.
   */
  async countEarlierPaidPacks(companyId: string, packId: string, paidAt: Date) {
    return this.prisma.analysisPack.count({
      where: {
        companyId,
        id: { not: packId },
        totalPaid: { gt: 0 },
        OR: [{ paidAt: { lt: paidAt } }, { paidAt, id: { lt: packId } }],
      },
    });
  }

  /**
   * Compras pagadas de la empresa que aún no causaron comisión, de la más
   * antigua a la más reciente. Es el backlog que se liquida al vincular un
   * vendedor dentro de la ventana.
   */
  async findPaidPacksWithoutCommission(companyId: string) {
    return this.prisma.analysisPack.findMany({
      where: {
        companyId,
        paidAt: { not: null },
        totalPaid: { gt: 0 },
        salesCommission: { is: null },
      },
      orderBy: { paidAt: 'asc' },
      select: { id: true },
    });
  }

  async findPackForAccrual(packId: string) {
    return this.prisma.analysisPack.findUnique({
      where: { id: packId },
      select: {
        id: true,
        companyId: true,
        totalPaid: true,
        taxBase: true,
        listTaxBase: true,
        taxRatePaid: true,
        taxIncludedPaid: true,
        currencyCode: true,
        paidAt: true,
        // Quién financió el descuento: solo se le resta al vendedor si el
        // código era SUYO. Uno de Creditia no le toca la comisión.
        promoDiscountAmount: true,
        promoCode: { select: { id: true, code: true, salesRepId: true } },
      },
    });
  }

  // ── Lotes de liquidación ──────────────────────────────────────────────

  private readonly payoutInclude = {
    salesRep: {
      select: {
        id: true,
        code: true,
        platformAdmin: { select: { name: true, lastName: true, email: true } },
      },
    },
    paidByAdmin: { select: { id: true, name: true, email: true } },
    _count: { select: { commissions: true } },
  } as const;

  /** Comisiones pendientes de un vendedor en un rango de meses. */
  async findPayableCommissions(params: {
    salesRepId: string;
    pendingStatusId: number;
    fromMonth?: string | null;
    toMonth?: string | null;
  }) {
    const { salesRepId, pendingStatusId, fromMonth, toMonth } = params;
    return this.prisma.salesCommission.findMany({
      where: {
        salesRepId,
        statusId: pendingStatusId,
        payoutId: null,
        ...(fromMonth || toMonth
          ? {
              accrualMonth: {
                ...(fromMonth ? { gte: fromMonth } : {}),
                ...(toMonth ? { lte: toMonth } : {}),
              },
            }
          : {}),
      },
      orderBy: { accruedAt: 'asc' },
      include: {
        company: { select: { name: true, nit: true } },
        analysisPack: { select: { quantityPurchased: true, paidAt: true } },
      },
    });
  }

  /**
   * Crea el lote y marca sus comisiones como pagadas en una sola transacción: o
   * queda todo liquidado con su comprobante, o no queda nada a medias.
   *
   * El updateMany vuelve a filtrar por estado pendiente y payoutId nulo, así que
   * si otra liquidación se le adelantó a alguna comisión, esta no la pisa. Si el
   * conteo no cuadra con lo previsto, se aborta: el comprobante diría un total
   * que no corresponde con sus líneas.
   */
  async createPayout(params: {
    reference: string;
    salesRepId: string;
    commissionIds: string[];
    totalAmount: number;
    currencyCode: string;
    fromMonth: string | null;
    toMonth: string | null;
    notes: string | null;
    paidBy: string | null;
    paidStatusId: number;
    pendingStatusId: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.commissionPayout.create({
        data: {
          reference: params.reference,
          salesRepId: params.salesRepId,
          commissionCount: params.commissionIds.length,
          totalAmount: params.totalAmount,
          currencyCode: params.currencyCode,
          fromMonth: params.fromMonth,
          toMonth: params.toMonth,
          notes: params.notes,
          paidBy: params.paidBy,
        },
      });

      const updated = await tx.salesCommission.updateMany({
        where: {
          id: { in: params.commissionIds },
          statusId: params.pendingStatusId,
          payoutId: null,
        },
        data: {
          statusId: params.paidStatusId,
          payoutId: payout.id,
          paidAt: payout.paidAt,
          paidBy: params.paidBy,
          payoutNotes: params.notes,
        },
      });

      if (updated.count !== params.commissionIds.length) {
        throw new Error(
          `La liquidación cambió mientras se procesaba (${updated.count} de ` +
            `${params.commissionIds.length} comisiones); vuelve a intentarlo`,
        );
      }

      return tx.commissionPayout.findUniqueOrThrow({
        where: { id: payout.id },
        include: this.payoutInclude,
      });
    });
  }

  /**
   * Devuelve las comisiones del lote a pendiente y marca el lote como revertido.
   * El lote NO se borra: el histórico debe mostrar que ese giro existió y que se
   * devolvió, con su motivo.
   */
  async revertPayout(params: {
    payoutId: string;
    pendingStatusId: number;
    revertedBy: string | null;
    reason: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.salesCommission.updateMany({
        where: { payoutId: params.payoutId },
        data: {
          statusId: params.pendingStatusId,
          payoutId: null,
          paidAt: null,
          paidBy: null,
          payoutNotes: `Liquidación revertida: ${params.reason}`,
        },
      });

      return tx.commissionPayout.update({
        where: { id: params.payoutId },
        data: {
          revertedAt: new Date(),
          revertedBy: params.revertedBy,
          revertReason: params.reason,
        },
        include: this.payoutInclude,
      });
    });
  }

  async findPayouts(salesRepId: string | null) {
    return this.prisma.commissionPayout.findMany({
      where: salesRepId ? { salesRepId } : undefined,
      orderBy: { paidAt: 'desc' },
      include: this.payoutInclude,
    });
  }

  /** Lote con sus líneas: alimenta el comprobante. */
  async findPayoutById(id: string) {
    return this.prisma.commissionPayout.findUnique({
      where: { id },
      include: {
        ...this.payoutInclude,
        commissions: {
          orderBy: { accruedAt: 'asc' },
          include: {
            company: { select: { name: true, nit: true } },
            analysisPack: { select: { quantityPurchased: true, paidAt: true } },
          },
        },
      },
    });
  }

  /** Nº de lotes emitidos en un mes, para el correlativo de la referencia. */
  async countPayoutsInMonth(yearMonth: string) {
    return this.prisma.commissionPayout.count({
      where: { reference: { startsWith: `PAY-${yearMonth}-` } },
    });
  }

  async markReceiptSent(payoutId: string) {
    return this.prisma.commissionPayout.update({
      where: { id: payoutId },
      data: { receiptSentAt: new Date() },
    });
  }

  /**
   * Consolidado mes a mes por vendedor. Se hace en SQL crudo porque Prisma no
   * agrupa y hace joins en la misma consulta, y aquí hace falta el nombre del
   * vendedor junto a los totales del mes.
   *
   * Las comisiones anuladas se excluyen de los totales: nunca fueron ingreso.
   */
  async monthlySummary(params: {
    salesRepId: string | null;
    fromMonth: string | null;
    toMonth: string | null;
  }): Promise<MonthlyCommissionRow[]> {
    const { salesRepId, fromMonth, toMonth } = params;

    const rows = await this.prisma.$queryRaw<
      Array<{
        month: string;
        sales_rep_id: string;
        code: string;
        name: string | null;
        new_count: bigint;
        recurring_count: bigint;
        base_amount: number | null;
        commission_amount: number | null;
        pending_amount: number | null;
        paid_amount: number | null;
        gross_commission_amount: number | null;
        discount_funded_amount: number | null;
      }>
    >`
      SELECT sc.accrual_month                                        AS month,
             sc.sales_rep_id,
             sr.code,
             pa.name,
             COUNT(*) FILTER (WHERE sc.kind = 'new')                 AS new_count,
             COUNT(*) FILTER (WHERE sc.kind = 'recurring')           AS recurring_count,
             SUM(sc.base_amount)                                     AS base_amount,
             SUM(sc.commission_amount)                               AS commission_amount,
             SUM(sc.gross_commission_amount)                         AS gross_commission_amount,
             SUM(sc.discount_funded_amount)                          AS discount_funded_amount,
             SUM(sc.commission_amount) FILTER (WHERE p.code = 'pending') AS pending_amount,
             SUM(sc.commission_amount) FILTER (WHERE p.code = 'paid')    AS paid_amount
        FROM sales_commissions sc
        JOIN sales_reps sr       ON sr.id = sc.sales_rep_id
        JOIN platform_admins pa  ON pa.id = sr.platform_admin_id
        JOIN parameters p        ON p.id = sc.status_id
       WHERE p.code <> 'cancelled'
         AND (${salesRepId}::uuid IS NULL OR sc.sales_rep_id = ${salesRepId}::uuid)
         AND (${fromMonth}::varchar IS NULL OR sc.accrual_month >= ${fromMonth})
         AND (${toMonth}::varchar IS NULL OR sc.accrual_month <= ${toMonth})
       GROUP BY sc.accrual_month, sc.sales_rep_id, sr.code, pa.name
       ORDER BY sc.accrual_month DESC, pa.name ASC
    `;

    return rows.map((r) => ({
      month: r.month,
      salesRepId: r.sales_rep_id,
      salesRepCode: r.code,
      salesRepName: r.name,
      newCount: Number(r.new_count),
      recurringCount: Number(r.recurring_count),
      baseAmount: Number(r.base_amount ?? 0),
      commissionAmount: Number(r.commission_amount ?? 0),
      pendingAmount: Number(r.pending_amount ?? 0),
      paidAmount: Number(r.paid_amount ?? 0),
      grossCommissionAmount: Number(r.gross_commission_amount ?? 0),
      discountFundedAmount: Number(r.discount_funded_amount ?? 0),
    }));
  }
}
