import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DashboardRepository } from './dashboard.repository.js';
import { FilterDashboardDto } from './dto/filter-dashboard.dto.js';

@Injectable()
export class DashboardService {
  constructor(private readonly repository: DashboardRepository) {}

  async getBasicDashboard(companyId: string) {
    const [
      totalCustomers,
      totalStudies,
      studiesThisMonth,
      activeUsers,
      creditAgg,
      studiesByStatusRaw,
      studiesByMonthRaw,
      customersByPersonTypeRaw,
      recentStudiesRaw,
    ] = await Promise.all([
      this.repository.countCustomers(companyId),
      this.repository.countStudies(companyId),
      this.repository.countStudiesThisMonth(companyId),
      this.repository.countActiveUsers(companyId),
      this.repository.creditSummaryThisMonth(companyId),
      this.repository.studiesByStatus(companyId),
      this.repository.studiesByMonth(companyId, 6),
      this.repository.customersByPersonType(companyId),
      this.repository.recentStudies(companyId, 5),
    ]);

    // Collect all parameter IDs that need labels
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
      requestedMonthlyCreditLine: s.requestedMonthlyCreditLine,
    }));

    return {
      summary: {
        totalCustomers,
        totalStudies,
        studiesThisMonth,
        activeUsers,
      },
      creditSummary: {
        totalRequestedThisMonth:
          creditAgg._sum.requestedMonthlyCreditLine ?? 0,
        avgRequestedThisMonth:
          creditAgg._avg.requestedMonthlyCreditLine ?? 0,
        avgRequestedTerm: creditAgg._avg.requestedTerm ?? 0,
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

    const basicData = await this.getBasicDashboard(companyId);

    const [
      financialIndicatorsRaw,
      stabilityDistribution,
      paymentCapacityTrendRaw,
      avgTurnoverRaw,
      topCustomersByCredit,
      revenueVsNetIncomeRaw,
      avgDebtStructureRaw,
      studiesByAnalystRaw,
      customersByEconomicActivityRaw,
    ] = await Promise.all([
      this.repository.avgFinancialIndicators(companyId, dateFrom, dateTo),
      this.repository.stabilityDistribution(companyId, dateFrom, dateTo),
      this.repository.paymentCapacityTrend(companyId, 12, dateFrom, dateTo),
      this.repository.avgTurnoverIndicators(companyId, dateFrom, dateTo),
      this.repository.topCustomersByCredit(companyId, 10, dateFrom, dateTo),
      this.repository.revenueVsNetIncome(companyId, 12, dateFrom, dateTo),
      this.repository.avgDebtStructure(companyId, dateFrom, dateTo),
      this.repository.studiesByAnalyst(companyId, dateFrom, dateTo),
      this.repository.customersByEconomicActivity(companyId),
    ]);

    // Collect IDs for label lookups
    const analystIds = studiesByAnalystRaw.map((a) => a.createdBy);
    const economicActivityIds = customersByEconomicActivityRaw
      .map((c) => c.economicActivityId)
      .filter((id): id is number => id !== null);

    const [profileNames, paramLabels] = await Promise.all([
      this.repository.getProfileNames(analystIds),
      this.repository.getParameterLabels(economicActivityIds),
    ]);

    const financialIndicators = {
      avgEbitda: financialIndicatorsRaw._avg.ebitda ?? 0,
      avgMonthlyPaymentCapacity:
        financialIndicatorsRaw._avg.monthlyPaymentCapacity ?? 0,
      avgStabilityFactor:
        financialIndicatorsRaw._avg.stabilityFactor ?? 0,
      avgMaxPaymentTime:
        financialIndicatorsRaw._avg.maximumPaymentTime ?? 0,
    };

    const paymentCapacityTrend = this.fillMonthsWithValue(
      paymentCapacityTrendRaw,
      12,
      'avgCapacity',
    );

    const avgTurnoverIndicators = {
      accountsReceivableTurnover:
        avgTurnoverRaw._avg.accountsReceivableTurnover ?? 0,
      inventoryTurnover: avgTurnoverRaw._avg.inventoryTurnover ?? 0,
      suppliersTurnover: avgTurnoverRaw._avg.suppliersTurnover ?? 0,
      maximumPaymentTime: avgTurnoverRaw._avg.maximumPaymentTime ?? 0,
    };

    const revenueVsNetIncome = this.fillMonthsWithDualValues(
      revenueVsNetIncomeRaw,
      12,
    );

    const avgEquity = avgDebtStructureRaw._avg.equity ?? 0;
    const avgDebtStructure = {
      avgCurrentLiabilities:
        avgDebtStructureRaw._avg.totalCurrentLiabilities ?? 0,
      avgNonCurrentLiabilities:
        avgDebtStructureRaw._avg.totalNonCurrentLiabilities ?? 0,
      avgEquity,
      debtToEquityRatio:
        avgEquity !== 0
          ? (avgDebtStructureRaw._avg.totalLiabilities ?? 0) / avgEquity
          : null,
    };

    const studiesByAnalyst = studiesByAnalystRaw.map((a) => ({
      analystId: a.createdBy,
      analystName: profileNames.get(a.createdBy) ?? 'Desconocido',
      count: a._count.id,
    }));

    const customersByEconomicActivity = customersByEconomicActivityRaw.map(
      (c) => ({
        economicActivityId: c.economicActivityId,
        label:
          paramLabels.get(c.economicActivityId!) ?? 'Desconocido',
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

  private async assertAdvancedAccess(companyId: string): Promise<void> {
    const company = await this.repository.getCompanySubscription(companyId);

    if (!company) {
      throw new NotFoundException(
        `Company with id=${companyId} not found`,
      );
    }

    const dashboardLevel = company.companySubscriptions[0]?.subscription?.dashboardLevel;

    if (dashboardLevel?.code !== 'advanced' && dashboardLevel?.code !== 'premium') {
      throw new ForbiddenException(
        'Your subscription does not include access to the advanced dashboard. Please upgrade to an advanced or premium plan.',
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
