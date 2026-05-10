import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DashboardRepository } from './dashboard.repository.js';
import { FilterDashboardDto } from './dto/filter-dashboard.dto.js';

export interface ComparableMetric {
  value: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
}

@Injectable()
export class DashboardService {
  constructor(private readonly repository: DashboardRepository) {}

  async getBasicDashboard(companyId: string) {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
    );
    const startOfPrevMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );

    const [
      totalCustomers,
      totalCustomersPrev,
      totalStudies,
      totalStudiesPrev,
      studiesThisMonth,
      studiesPrevMonth,
      activeUsers,
      activeUsersPrev,
      creditAggCurrent,
      creditAggPrev,
      studiesByStatusRaw,
      studiesByMonthRaw,
      customersByPersonTypeRaw,
      recentStudiesRaw,
    ] = await Promise.all([
      this.repository.countCustomers(companyId),
      this.repository.countCustomers(companyId, startOfThisMonth),
      this.repository.countStudies(companyId),
      this.repository.countStudies(companyId, startOfThisMonth),
      this.repository.countStudiesInRange(
        companyId,
        startOfThisMonth,
        startOfNextMonth,
      ),
      this.repository.countStudiesInRange(
        companyId,
        startOfPrevMonth,
        startOfThisMonth,
      ),
      this.repository.countActiveUsers(companyId),
      this.repository.countActiveUsers(companyId, startOfThisMonth),
      this.repository.creditSummaryInRange(
        companyId,
        startOfThisMonth,
        startOfNextMonth,
      ),
      this.repository.creditSummaryInRange(
        companyId,
        startOfPrevMonth,
        startOfThisMonth,
      ),
      this.repository.studiesByStatus(companyId),
      this.repository.studiesByMonth(companyId, 6),
      this.repository.customersByPersonType(companyId),
      this.repository.recentStudies(companyId, 5),
    ]);

    const paramIds = [
      ...studiesByStatusRaw.map((s) => s.statusId),
      ...customersByPersonTypeRaw.map((c) => c.personTypeId),
    ];
    const paramLabels = await this.repository.getParameterLabels(paramIds);

    const studiesByStatus = studiesByStatusRaw.map((s) => ({
      statusId: s.statusId,
      label: paramLabels.get(s.statusId) ?? 'Desconocido',
      count: s._count.id,
    }));

    const studiesByMonth = this.fillMonths(studiesByMonthRaw, 6);

    const customersByPersonType = customersByPersonTypeRaw.map((c) => ({
      personTypeId: c.personTypeId,
      label: paramLabels.get(c.personTypeId) ?? 'Desconocido',
      count: c._count.id,
    }));

    const recentStudies = recentStudiesRaw.map((s) => ({
      id: s.id,
      customerName: s.customer.businessName,
      studyDate: s.studyDate,
      statusLabel: s.status.label,
      requestedCreditLine: s.requestedCreditLine,
    }));

    return {
      summary: {
        totalCustomers: this.compare(totalCustomers, totalCustomersPrev),
        totalStudies: this.compare(totalStudies, totalStudiesPrev),
        studiesThisMonth: this.compare(studiesThisMonth, studiesPrevMonth),
        activeUsers: this.compare(activeUsers, activeUsersPrev),
      },
      creditSummary: {
        totalRequestedThisMonth: this.compare(
          Number(creditAggCurrent._sum.requestedCreditLine ?? 0),
          Number(creditAggPrev._sum.requestedCreditLine ?? 0),
        ),
        avgRequestedThisMonth: this.compare(
          Number(creditAggCurrent._avg.requestedCreditLine ?? 0),
          Number(creditAggPrev._avg.requestedCreditLine ?? 0),
        ),
        avgRequestedTerm: this.compare(
          Number(creditAggCurrent._avg.requestedTerm ?? 0),
          Number(creditAggPrev._avg.requestedTerm ?? 0),
        ),
      },
      studiesByStatus,
      studiesByMonth,
      customersByPersonType,
      recentStudies,
    };
  }

  async getAdvancedDashboard(companyId: string, filters: FilterDashboardDto) {
    await this.assertAdvancedAccess(companyId);

    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : undefined;
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : undefined;

    const { previousFrom, previousTo } = this.resolvePreviousRange(
      dateFrom,
      dateTo,
    );

    const basicData = await this.getBasicDashboard(companyId);

    const [
      financialIndicatorsRaw,
      financialIndicatorsPrev,
      stabilityDistribution,
      paymentCapacityTrendRaw,
      avgTurnoverRaw,
      avgTurnoverPrev,
      topCustomersByCredit,
      revenueVsNetIncomeRaw,
      avgDebtStructureRaw,
      avgDebtStructurePrev,
      studiesByAnalystRaw,
      customersByEconomicActivityRaw,
    ] = await Promise.all([
      this.repository.avgFinancialIndicators(companyId, dateFrom, dateTo),
      this.repository.avgFinancialIndicatorsInRange(
        companyId,
        previousFrom,
        previousTo,
      ),
      this.repository.stabilityDistribution(companyId, dateFrom, dateTo),
      this.repository.paymentCapacityTrend(companyId, 12, dateFrom, dateTo),
      this.repository.avgTurnoverIndicators(companyId, dateFrom, dateTo),
      this.repository.avgTurnoverIndicatorsInRange(
        companyId,
        previousFrom,
        previousTo,
      ),
      this.repository.topCustomersByCredit(companyId, 10, dateFrom, dateTo),
      this.repository.revenueVsNetIncome(companyId, 12, dateFrom, dateTo),
      this.repository.avgDebtStructure(companyId, dateFrom, dateTo),
      this.repository.avgDebtStructureInRange(
        companyId,
        previousFrom,
        previousTo,
      ),
      this.repository.studiesByAnalyst(companyId, dateFrom, dateTo),
      this.repository.customersByEconomicActivity(companyId),
    ]);

    const analystIds = studiesByAnalystRaw.map((a) => a.createdBy);
    const economicActivityIds = customersByEconomicActivityRaw
      .map((c) => c.economicActivityId)
      .filter((id): id is number => id !== null);

    const [profileNames, paramLabels] = await Promise.all([
      this.repository.getProfileNames(analystIds),
      this.repository.getParameterLabels(economicActivityIds),
    ]);

    const financialIndicators = {
      avgEbitda: this.compare(
        Number(financialIndicatorsRaw._avg.ebitda ?? 0),
        Number(financialIndicatorsPrev._avg.ebitda ?? 0),
      ),
      avgMonthlyPaymentCapacity: this.compare(
        Number(financialIndicatorsRaw._avg.monthlyPaymentCapacity ?? 0),
        Number(financialIndicatorsPrev._avg.monthlyPaymentCapacity ?? 0),
      ),
      avgStabilityFactor: this.compare(
        Number(financialIndicatorsRaw._avg.stabilityFactor ?? 0),
        Number(financialIndicatorsPrev._avg.stabilityFactor ?? 0),
      ),
      avgPaymentTimeSuppliers: this.compare(
        Number(financialIndicatorsRaw._avg.paymentTimeSuppliers ?? 0),
        Number(financialIndicatorsPrev._avg.paymentTimeSuppliers ?? 0),
      ),
    };

    const paymentCapacityTrend = this.fillMonthsWithValue(
      paymentCapacityTrendRaw,
      12,
      'avgCapacity',
    );

    const avgTurnoverIndicators = {
      accountsReceivableTurnover: this.compare(
        Number(avgTurnoverRaw._avg.accountsReceivableTurnover ?? 0),
        Number(avgTurnoverPrev._avg.accountsReceivableTurnover ?? 0),
      ),
      inventoryTurnover: this.compare(
        Number(avgTurnoverRaw._avg.inventoryTurnover ?? 0),
        Number(avgTurnoverPrev._avg.inventoryTurnover ?? 0),
      ),
      suppliersTurnover: this.compare(
        Number(avgTurnoverRaw._avg.suppliersTurnover ?? 0),
        Number(avgTurnoverPrev._avg.suppliersTurnover ?? 0),
      ),
      paymentTimeSuppliers: this.compare(
        Number(avgTurnoverRaw._avg.paymentTimeSuppliers ?? 0),
        Number(avgTurnoverPrev._avg.paymentTimeSuppliers ?? 0),
      ),
    };

    const revenueVsNetIncome = this.fillMonthsWithDualValues(
      revenueVsNetIncomeRaw,
      12,
    );

    const avgEquityCurrent = Number(avgDebtStructureRaw._avg.equity ?? 0);
    const avgEquityPrev = Number(avgDebtStructurePrev._avg.equity ?? 0);
    const debtToEquityCurrent =
      avgEquityCurrent !== 0
        ? Number(avgDebtStructureRaw._avg.totalLiabilities ?? 0) /
          avgEquityCurrent
        : 0;
    const debtToEquityPrev =
      avgEquityPrev !== 0
        ? Number(avgDebtStructurePrev._avg.totalLiabilities ?? 0) /
          avgEquityPrev
        : 0;

    const avgDebtStructure = {
      avgCurrentLiabilities: this.compare(
        Number(avgDebtStructureRaw._avg.totalCurrentLiabilities ?? 0),
        Number(avgDebtStructurePrev._avg.totalCurrentLiabilities ?? 0),
      ),
      avgNonCurrentLiabilities: this.compare(
        Number(avgDebtStructureRaw._avg.totalNonCurrentLiabilities ?? 0),
        Number(avgDebtStructurePrev._avg.totalNonCurrentLiabilities ?? 0),
      ),
      avgEquity: this.compare(avgEquityCurrent, avgEquityPrev),
      debtToEquityRatio: this.compare(debtToEquityCurrent, debtToEquityPrev),
    };

    const studiesByAnalyst = studiesByAnalystRaw.map((a) => ({
      analystId: a.createdBy,
      analystName: profileNames.get(a.createdBy) ?? 'Desconocido',
      count: a._count.id,
    }));

    const customersByEconomicActivity = customersByEconomicActivityRaw.map(
      (c) => ({
        economicActivityId: c.economicActivityId,
        label: paramLabels.get(c.economicActivityId!) ?? 'Desconocido',
        count: c._count.id,
      }),
    );

    return {
      ...basicData,
      financialIndicators,
      stabilityDistribution,
      paymentCapacityTrend,
      avgTurnoverIndicators,
      topCustomersByCredit,
      revenueVsNetIncome,
      avgDebtStructure,
      studiesByAnalyst,
      customersByEconomicActivity,
    };
  }

  // ── Private helpers ─────────────────────────────────────────

  private compare(value: number, previous: number): ComparableMetric {
    const v = Number(value ?? 0);
    const p = Number(previous ?? 0);
    const delta = v - p;
    const deltaPercent =
      p === 0 ? null : Number(((delta / Math.abs(p)) * 100).toFixed(2));
    return { value: v, previous: p, delta, deltaPercent };
  }

  private resolvePreviousRange(
    dateFrom?: Date,
    dateTo?: Date,
  ): { previousFrom: Date; previousTo: Date } {
    const now = new Date();
    const effectiveTo = dateTo ?? now;
    const effectiveFrom =
      dateFrom ??
      new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    const spanMs = effectiveTo.getTime() - effectiveFrom.getTime();
    const previousTo = new Date(effectiveFrom.getTime());
    const previousFrom = new Date(effectiveFrom.getTime() - spanMs);

    return { previousFrom, previousTo };
  }

  private async assertAdvancedAccess(companyId: string): Promise<void> {
    const company = await this.repository.getCompanySubscription(companyId);

    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    const dashboardLevel =
      company.companySubscriptions[0]?.subscription?.dashboardLevel;

    if (
      dashboardLevel?.code !== 'advanced' &&
      dashboardLevel?.code !== 'premium'
    ) {
      throw new ForbiddenException(
        'Su suscripción no incluye acceso al dashboard avanzado. Actualice a un plan avanzado o premium.',
      );
    }
  }

  private fillMonths(
    data: Array<{ month: string; count: number }>,
    months: number,
  ): Array<{ month: string; count: number }> {
    const map = new Map(data.map((d) => [d.month, d.count]));
    const result: Array<{ month: string; count: number }> = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ month: key, count: map.get(key) ?? 0 });
    }

    return result;
  }

  private fillMonthsWithValue(
    data: Array<{ month: string; [key: string]: any }>,
    months: number,
    valueKey: string,
  ): Array<{ month: string; value: number }> {
    const map = new Map(data.map((d) => [d.month, d[valueKey] ?? 0]));
    const result: Array<{ month: string; value: number }> = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ month: key, value: map.get(key) ?? 0 });
    }

    return result;
  }

  private fillMonthsWithDualValues(
    data: Array<{ month: string; avgRevenue: number; avgNetIncome: number }>,
    months: number,
  ): Array<{ month: string; avgRevenue: number; avgNetIncome: number }> {
    const map = new Map(data.map((d) => [d.month, d]));
    const result: Array<{
      month: string;
      avgRevenue: number;
      avgNetIncome: number;
    }> = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = map.get(key);
      result.push({
        month: key,
        avgRevenue: entry?.avgRevenue ?? 0,
        avgNetIncome: entry?.avgNetIncome ?? 0,
      });
    }

    return result;
  }
}
