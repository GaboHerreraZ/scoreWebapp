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
      include: this.commissionInclude,
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
      _sum: { commissionAmount: true, baseAmount: true },
      _count: true,
    });
    return {
      count: result._count,
      baseAmount: result._sum.baseAmount ?? 0,
      commissionAmount: result._sum.commissionAmount ?? 0,
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
        currencyCode: true,
        paidAt: true,
      },
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
    }));
  }
}
