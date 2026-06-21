import { Injectable, BadRequestException } from '@nestjs/common';
import { AdminStatsRepository } from './admin-stats.repository.js';
import { StatsPeriodDto } from './dto/stats-period.dto.js';
import { StatsRankingDto } from './dto/stats-ranking.dto.js';

/** Rango máximo permitido para un periodo (1 año) — evita queries enormes. */
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

@Injectable()
export class AdminStatsService {
  constructor(private readonly repository: AdminStatsRepository) {}

  // ── Helpers de periodo ────────────────────────────────────────────────

  /**
   * Resuelve la ventana [from, to). Sin fechas → mes actual (desde el día 1 a
   * las 00:00 hasta ahora). Valida orden y rango máximo.
   */
  private resolvePeriod(dto: StatsPeriodDto): { from: Date; to: Date } {
    const now = new Date();
    const from = dto.from
      ? new Date(dto.from)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = dto.to ? new Date(dto.to) : now;

    if (from >= to) {
      throw new BadRequestException('"from" debe ser anterior a "to"');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException('El rango no puede superar 1 año');
    }
    return { from, to };
  }

  /** Periodo inmediatamente anterior, del mismo tamaño (para los deltas). */
  private previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
    const span = to.getTime() - from.getTime();
    return { from: new Date(from.getTime() - span), to: from };
  }

  /** Δ% de current vs previous; null si no hay base previa (evita /0). */
  private delta(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null;
    return Math.round(((current - previous) / previous) * 10000) / 100;
  }

  private pct(consumed: number, purchased: number): number {
    if (purchased === 0) return 0;
    return Math.round((consumed / purchased) * 10000) / 100;
  }

  private paginate(total: number, page: number, limit: number) {
    return { total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private resolveRanking(dto: StatsRankingDto) {
    const period = this.resolvePeriod(dto);
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 5;
    return { period, page, limit, skip: (page - 1) * limit };
  }

  // ── 1. Overview ───────────────────────────────────────────────────────

  async getOverview(dto: StatsPeriodDto) {
    const { from, to } = this.resolvePeriod(dto);
    const prev = this.previousPeriod(from, to);

    const [sales, consumed, prevSales, prevConsumed] = await Promise.all([
      this.repository.salesSummary(from, to),
      this.repository.consumptionCount(from, to),
      this.repository.salesSummary(prev.from, prev.to),
      this.repository.consumptionCount(prev.from, prev.to),
    ]);

    const creditsSold = Number(sales?.credits_sold ?? 0);
    const revenue = Number(sales?.revenue ?? 0);
    const purchases = Number(sales?.purchases ?? 0);
    const prevCreditsSold = Number(prevSales?.credits_sold ?? 0);
    const prevRevenue = Number(prevSales?.revenue ?? 0);

    return {
      period: { from, to },
      sales: {
        creditsSold,
        revenue,
        purchases,
        avgTicket: purchases > 0 ? Math.round(revenue / purchases) : 0,
      },
      usage: { creditsConsumed: consumed },
      previous: {
        creditsSold: prevCreditsSold,
        revenue: prevRevenue,
        creditsConsumed: prevConsumed,
      },
      deltas: {
        creditsSoldPct: this.delta(creditsSold, prevCreditsSold),
        revenuePct: this.delta(revenue, prevRevenue),
        consumedPct: this.delta(consumed, prevConsumed),
      },
    };
  }

  // ── 2. Top consumers ──────────────────────────────────────────────────

  async getTopConsumers(dto: StatsRankingDto) {
    const { period, page, limit, skip } = this.resolveRanking(dto);
    const { data, total } = await this.repository.topConsumers(
      period.from,
      period.to,
      skip,
      limit,
    );
    return {
      data: data.map((r) => ({
        companyId: r.company_id,
        companyName: r.company_name,
        nit: r.nit,
        consumptions: Number(r.consumptions),
      })),
      meta: this.paginate(total, page, limit),
      period,
    };
  }

  // ── 3. Inactive clients (compraron y no consumen) ─────────────────────

  async getInactiveClients(dto: StatsRankingDto) {
    const { period, page, limit, skip } = this.resolveRanking(dto);
    const { data, total } = await this.repository.inactiveClients(
      period.from,
      period.to,
      skip,
      limit,
    );
    return {
      data: data.map((r) => ({
        companyId: r.company_id,
        companyName: r.company_name,
        nit: r.nit,
        creditsPurchased: Number(r.credits_purchased),
        lastConsumptionAt: r.last_consumption_at,
      })),
      meta: this.paginate(total, page, limit),
      period,
    };
  }

  // ── 4. Utilization ────────────────────────────────────────────────────

  async getUtilization(dto: StatsRankingDto) {
    const { period, page, limit, skip } = this.resolveRanking(dto);
    const { data, total } = await this.repository.utilization(
      period.from,
      period.to,
      skip,
      limit,
    );
    return {
      data: data.map((r) => {
        const purchased = Number(r.credits_purchased);
        const consumed = Number(r.credits_consumed);
        return {
          companyId: r.company_id,
          companyName: r.company_name,
          nit: r.nit,
          creditsPurchased: purchased,
          creditsConsumed: consumed,
          utilizationPct: this.pct(consumed, purchased),
        };
      }),
      meta: this.paginate(total, page, limit),
      period,
    };
  }

  // ── 5. Expiring credits ───────────────────────────────────────────────

  async getExpiringCredits(dto: StatsRankingDto & { days?: number }) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 5;
    const skip = (page - 1) * limit;
    const days = dto.days ?? 30;

    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'analysis_pack_status',
      'active',
    );
    if (!activeStatus) {
      throw new BadRequestException('Falta el parámetro de estado active');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + days);

    const { data, total } = await this.repository.expiringCredits(
      activeStatus.id,
      today,
      windowEnd,
      skip,
      limit,
    );
    return {
      data: data.map((r) => ({
        companyId: r.company_id,
        companyName: r.company_name,
        nit: r.nit,
        remaining: Number(r.remaining),
        endDate: r.end_date,
        packId: r.pack_id,
      })),
      meta: this.paginate(total, page, limit),
      windowDays: days,
    };
  }

  // ── 6. Monthly trend ──────────────────────────────────────────────────

  async getMonthlyTrend(months = 6) {
    const safeMonths = Math.min(Math.max(months, 1), 24);
    const rows = await this.repository.monthlyConsumption(safeMonths);
    return {
      months: safeMonths,
      data: rows.map((r) => ({
        month: r.month,
        consumed: Number(r.consumed),
      })),
    };
  }

  // ── 7. Promo usage ────────────────────────────────────────────────────

  async getPromoUsage(dto: StatsRankingDto) {
    const { period, page, limit, skip } = this.resolveRanking(dto);
    const { data, total } = await this.repository.promoUsage(
      period.from,
      period.to,
      skip,
      limit,
    );
    return {
      data: data.map((r) => ({
        promoCodeId: r.promo_code_id,
        code: r.code,
        scope: r.scope_code,
        redemptions: Number(r.redemptions),
        totalDiscount: Number(r.total_discount ?? 0),
      })),
      meta: this.paginate(total, page, limit),
      period,
    };
  }
}
