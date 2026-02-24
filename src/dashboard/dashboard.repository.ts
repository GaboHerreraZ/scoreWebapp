import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── BASIC DASHBOARD QUERIES ─────────────────────────────────

  async countCustomers(companyId: string): Promise<number> {
    return this.prisma.customer.count({ where: { companyId } });
  }

  async countStudies(companyId: string): Promise<number> {
    return this.prisma.creditStudy.count({ where: { companyId } });
  }

  async countStudiesThisMonth(companyId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return this.prisma.creditStudy.count({
      where: {
        companyId,
        createdAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
    });
  }

  async countActiveUsers(companyId: string): Promise<number> {
    return this.prisma.userCompany.count({
      where: { companyId, isActive: true },
    });
  }

  async creditSummaryThisMonth(companyId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return this.prisma.creditStudy.aggregate({
      where: {
        companyId,
        createdAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
      _sum: { requestedMonthlyCreditLine: true },
      _avg: { requestedMonthlyCreditLine: true, requestedTerm: true },
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

  async customersByPersonType(companyId: string) {
    return this.prisma.customer.groupBy({
      by: ['personTypeId'],
      where: { companyId },
      _count: { id: true },
    });
  }

  async recentStudies(companyId: string, limit: number) {
    return this.prisma.creditStudy.findMany({
      where: { companyId },
      orderBy: { studyDate: 'desc' },
      take: limit,
      select: {
        id: true,
        studyDate: true,
        requestedMonthlyCreditLine: true,
        customer: { select: { businessName: true } },
        status: { select: { id: true, label: true } },
      },
    });
  }

  // ── ADVANCED DASHBOARD QUERIES ──────────────────────────────

  async avgFinancialIndicators(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const where: Prisma.CreditStudyWhereInput = {
      companyId,
      stabilityFactor: { not: null },
    };
    if (dateFrom || dateTo) {
      where.studyDate = {};
      if (dateFrom) where.studyDate.gte = dateFrom;
      if (dateTo) where.studyDate.lte = dateTo;
    }

    return this.prisma.creditStudy.aggregate({
      where,
      _avg: {
        ebitda: true,
        monthlyPaymentCapacity: true,
        stabilityFactor: true,
        maximumPaymentTime: true,
      },
    });
  }

  async stabilityDistribution(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const effectiveDateFrom = dateFrom ?? new Date('1900-01-01');
    const effectiveDateTo = dateTo ?? new Date('2100-01-01');

    const rows = await this.prisma.$queryRaw<
      Array<{ band: string; count: bigint }>
    >`
      SELECT
        CASE
          WHEN stability_factor <= 0.33 THEN 'high_risk'
          WHEN stability_factor <= 0.66 THEN 'medium_risk'
          ELSE 'low_risk'
        END AS band,
        COUNT(*)::bigint AS count
      FROM credit_studies
      WHERE company_id = ${companyId}::uuid
        AND stability_factor IS NOT NULL
        AND study_date >= ${effectiveDateFrom}
        AND study_date <= ${effectiveDateTo}
      GROUP BY band
      ORDER BY band
    `;

    return rows.map((r) => ({ band: r.band, count: Number(r.count) }));
  }

  async paymentCapacityTrend(
    companyId: string,
    months: number,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const defaultFrom = new Date();
    defaultFrom.setMonth(defaultFrom.getMonth() - months);
    defaultFrom.setDate(1);
    defaultFrom.setHours(0, 0, 0, 0);

    const effectiveDateFrom = dateFrom ?? defaultFrom;
    const effectiveDateTo = dateTo ?? new Date();

    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; avg_capacity: number | null }>
    >`
      SELECT
        to_char(study_date, 'YYYY-MM') AS month,
        AVG(monthly_payment_capacity) AS avg_capacity
      FROM credit_studies
      WHERE company_id = ${companyId}::uuid
        AND monthly_payment_capacity IS NOT NULL
        AND study_date >= ${effectiveDateFrom}
        AND study_date <= ${effectiveDateTo}
      GROUP BY to_char(study_date, 'YYYY-MM')
      ORDER BY month ASC
    `;

    return rows.map((r) => ({
      month: r.month,
      avgCapacity: Number(r.avg_capacity ?? 0),
    }));
  }

  async avgTurnoverIndicators(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const where: Prisma.CreditStudyWhereInput = {
      companyId,
      accountsReceivableTurnover: { not: null },
    };
    if (dateFrom || dateTo) {
      where.studyDate = {};
      if (dateFrom) where.studyDate.gte = dateFrom;
      if (dateTo) where.studyDate.lte = dateTo;
    }

    return this.prisma.creditStudy.aggregate({
      where,
      _avg: {
        accountsReceivableTurnover: true,
        inventoryTurnover: true,
        suppliersTurnover: true,
        maximumPaymentTime: true,
      },
    });
  }

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
        studies_count: bigint;
      }>
    >`
      SELECT
        c.id AS customer_id,
        c.business_name,
        COALESCE(SUM(cs.requested_monthly_credit_line), 0) AS total_credit,
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
      totalCredit: Number(r.total_credit),
      studiesCount: Number(r.studies_count),
    }));
  }

  async revenueVsNetIncome(
    companyId: string,
    months: number,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const defaultFrom = new Date();
    defaultFrom.setMonth(defaultFrom.getMonth() - months);
    defaultFrom.setDate(1);
    defaultFrom.setHours(0, 0, 0, 0);

    const effectiveDateFrom = dateFrom ?? defaultFrom;
    const effectiveDateTo = dateTo ?? new Date();

    const rows = await this.prisma.$queryRaw<
      Array<{
        month: string;
        avg_revenue: number | null;
        avg_net_income: number | null;
      }>
    >`
      SELECT
        to_char(study_date, 'YYYY-MM') AS month,
        AVG(ordinary_activity_revenue) AS avg_revenue,
        AVG(net_income) AS avg_net_income
      FROM credit_studies
      WHERE company_id = ${companyId}::uuid
        AND study_date >= ${effectiveDateFrom}
        AND study_date <= ${effectiveDateTo}
      GROUP BY to_char(study_date, 'YYYY-MM')
      ORDER BY month ASC
    `;

    return rows.map((r) => ({
      month: r.month,
      avgRevenue: Number(r.avg_revenue ?? 0),
      avgNetIncome: Number(r.avg_net_income ?? 0),
    }));
  }

  async avgDebtStructure(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const where: Prisma.CreditStudyWhereInput = { companyId };
    if (dateFrom || dateTo) {
      where.studyDate = {};
      if (dateFrom) where.studyDate.gte = dateFrom;
      if (dateTo) where.studyDate.lte = dateTo;
    }

    return this.prisma.creditStudy.aggregate({
      where,
      _avg: {
        totalCurrentLiabilities: true,
        totalNonCurrentLiabilities: true,
        equity: true,
        totalLiabilities: true,
      },
    });
  }

  async studiesByAnalyst(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    const where: Prisma.CreditStudyWhereInput = { companyId };
    if (dateFrom || dateTo) {
      where.studyDate = {};
      if (dateFrom) where.studyDate.gte = dateFrom;
      if (dateTo) where.studyDate.lte = dateTo;
    }

    return this.prisma.creditStudy.groupBy({
      by: ['createdBy'],
      where,
      _count: { id: true },
    });
  }

  async customersByEconomicActivity(companyId: string) {
    return this.prisma.customer.groupBy({
      by: ['economicActivityId'],
      where: { companyId, economicActivityId: { not: null } },
      _count: { id: true },
    });
  }

  // ── HELPERS ─────────────────────────────────────────────────

  async getParameterLabels(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();

    const params = await this.prisma.parameter.findMany({
      where: { id: { in: ids } },
      select: { id: true, label: true },
    });

    return new Map(params.map((p) => [p.id, p.label]));
  }

  async getProfileNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const profiles = await this.prisma.profile.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, lastName: true },
    });

    return new Map(
      profiles.map((p) => [
        p.id,
        [p.name, p.lastName].filter(Boolean).join(' '),
      ]),
    );
  }

  async getCompanySubscription(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        companySubscriptions: {
          where: { isCurrent: true },
          take: 1,
          select: {
            subscription: {
              select: {
                dashboardLevel: true,
              },
            },
          },
        },
      },
    });
  }
}
