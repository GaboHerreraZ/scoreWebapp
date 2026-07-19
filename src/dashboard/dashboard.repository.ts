import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── BASIC DASHBOARD QUERIES ─────────────────────────────────

  async countCustomers(companyId: string, before?: Date): Promise<number> {
    return this.prisma.customer.count({
      where: {
        companyId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
    });
  }

  async countStudiesInRange(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.creditStudy.count({
      where: {
        companyId,
        createdAt: { gte: from, lt: to },
      },
    });
  }

  async studiesByStatus(companyId: string) {
    return this.prisma.creditStudy.groupBy({
      by: ['statusId'],
      where: { companyId },
      _count: { id: true },
    });
  }

  async studiesByMonth(companyId: string, months: number) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);

    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; count: bigint }>
    >`
      SELECT
        to_char(study_date, 'YYYY-MM') AS month,
        COUNT(*)::bigint AS count
      FROM credit_studies
      WHERE company_id = ${companyId}::uuid
        AND study_date >= ${cutoff}
      GROUP BY to_char(study_date, 'YYYY-MM')
      ORDER BY month ASC
    `;

    return rows.map((r) => ({ month: r.month, count: Number(r.count) }));
  }

  async recentStudies(companyId: string, limit: number) {
    return this.prisma.creditStudy.findMany({
      where: { companyId },
      orderBy: { studyDate: 'desc' },
      take: limit,
      select: {
        id: true,
        studyDate: true,
        requestedCreditLine: true,
        recommendedCreditLine: true,
        viabilityScore: true,
        viabilityStatus: true,
        customer: { select: { businessName: true } },
        status: { select: { id: true, code: true, label: true } },
      },
    });
  }

  // ── ADVANCED DASHBOARD QUERIES ──────────────────────────────
  // Todo lo de abajo lee de datos VIVOS del modelo actual: veredictos y montos
  // del análisis de viabilidad (CreditStudy), riesgo de la central
  // (CustomerRiskSnapshot) y saldo de consultas (AnalysisPack). Los promedios de
  // cifras contables entre clientes de tamaños distintos se eliminaron a
  // propósito: no soportan ninguna decisión.

  /** Filtro de rango sobre studyDate (opcional en ambos extremos). */
  private studyDateFilter(
    dateFrom?: Date,
    dateTo?: Date,
  ): Prisma.CreditStudyWhereInput {
    if (!dateFrom && !dateTo) return {};
    const studyDate: Prisma.DateTimeFilter = {};
    if (dateFrom) studyDate.gte = dateFrom;
    if (dateTo) studyDate.lte = dateTo;
    return { studyDate };
  }

  /** Veredictos de viabilidad (approved/conditional/rejected) en el rango. */
  async verdictsInRange(companyId: string, dateFrom?: Date, dateTo?: Date) {
    return this.prisma.creditStudy.groupBy({
      by: ['viabilityStatus'],
      where: {
        companyId,
        viabilityStatus: { not: null },
        ...this.studyDateFilter(dateFrom, dateTo),
      },
      _count: { id: true },
    });
  }

  /** Score de viabilidad promedio de los estudios analizados en el rango. */
  async avgViabilityScoreInRange(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const agg = await this.prisma.creditStudy.aggregate({
      where: {
        companyId,
        viabilityScore: { not: null },
        ...this.studyDateFilter(dateFrom, dateTo),
      },
      _avg: { viabilityScore: true },
    });
    return agg._avg.viabilityScore;
  }

  /**
   * Dinero del período: total solicitado (todos los estudios del rango) y total
   * AVALADO por Creditia (recommendedCreditLine de los estudios con veredicto
   * approved/conditional; un rechazado no avala nada).
   */
  async creditTotalsInRange(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<{ totalRequested: number; totalApproved: number }> {
    const range = this.studyDateFilter(dateFrom, dateTo);
    const [requested, approved] = await Promise.all([
      this.prisma.creditStudy.aggregate({
        where: { companyId, ...range },
        _sum: { requestedCreditLine: true },
      }),
      this.prisma.creditStudy.aggregate({
        where: {
          companyId,
          viabilityStatus: { in: ['approved', 'conditional'] },
          ...range,
        },
        _sum: { recommendedCreditLine: true },
      }),
    ]);
    return {
      totalRequested: Number(requested._sum.requestedCreditLine ?? 0),
      totalApproved: Number(approved._sum.recommendedCreditLine ?? 0),
    };
  }

  /**
   * Riesgo de la cartera según la central: el snapshot MÁS RECIENTE de cada
   * cliente de la empresa (score + saldo en mora). El servicio los agrupa por
   * banda de score y cuenta la mora vigente.
   */
  async bureauRiskLatest(
    companyId: string,
  ): Promise<Array<{ score: number | null; saldoMora: number | null }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ score: number | null; saldo_mora: number | null }>
    >`
      SELECT DISTINCT ON (s.customer_id) s.score, s.saldo_mora
      FROM customer_risk_snapshots s
      JOIN customers c ON c.id = s.customer_id
      WHERE c.company_id = ${companyId}::uuid
      ORDER BY s.customer_id, s.created_at DESC
    `;
    return rows.map((r) => ({
      score: r.score === null ? null : Number(r.score),
      saldoMora: r.saldo_mora === null ? null : Number(r.saldo_mora),
    }));
  }

  /**
   * Saldo de consultas de la empresa: bolsas activas y vigentes, con lo comprado,
   * lo consumido y su vencimiento. Pocas filas por empresa (se agrega en el
   * servicio).
   */
  async activePacksBalance(companyId: string) {
    return this.prisma.analysisPack.findMany({
      where: {
        companyId,
        status: { type: 'analysis_pack_status', code: 'active' },
        endDate: { gte: new Date() },
      },
      select: {
        quantityPurchased: true,
        quantityConsumed: true,
        endDate: true,
      },
      orderBy: { endDate: 'asc' },
    });
  }

  /** Top clientes por crédito solicitado + lo avalado por Creditia, en el rango. */
  async topCustomersByCredit(
    companyId: string,
    limit: number,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const effectiveDateFrom = dateFrom ?? new Date('1900-01-01');
    const effectiveDateTo = dateTo ?? new Date('2100-01-01');

    const rows = await this.prisma.$queryRaw<
      Array<{
        customer_id: string;
        business_name: string;
        total_credit: number;
        total_approved: number;
        studies_count: bigint;
      }>
    >`
      SELECT
        c.id AS customer_id,
        c.business_name,
        COALESCE(SUM(cs.requested_credit_line), 0) AS total_credit,
        COALESCE(SUM(
          CASE WHEN cs.viability_status IN ('approved', 'conditional')
               THEN cs.recommended_credit_line ELSE 0 END
        ), 0) AS total_approved,
        COUNT(cs.id)::bigint AS studies_count
      FROM credit_studies cs
      JOIN customers c ON c.id = cs.customer_id
      WHERE cs.company_id = ${companyId}::uuid
        AND cs.study_date >= ${effectiveDateFrom}
        AND cs.study_date <= ${effectiveDateTo}
      GROUP BY c.id, c.business_name
      ORDER BY total_credit DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      customerId: r.customer_id,
      businessName: r.business_name,
      totalRequested: Number(r.total_credit),
      totalApproved: Number(r.total_approved),
      studiesCount: Number(r.studies_count),
    }));
  }

  // ── HELPERS ─────────────────────────────────────────────────

  /** Parámetros por id → {code, label} (para el pipeline del flujo). */
  async getParameterMeta(
    ids: number[],
  ): Promise<Map<number, { code: string; label: string }>> {
    if (ids.length === 0) return new Map();

    const params = await this.prisma.parameter.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, label: true },
    });

    return new Map(params.map((p) => [p.id, { code: p.code, label: p.label }]));
  }
}
