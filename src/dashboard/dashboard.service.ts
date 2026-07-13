import { Injectable } from '@nestjs/common';
import { DashboardRepository } from './dashboard.repository.js';
import { FilterDashboardDto } from './dto/filter-dashboard.dto.js';
import { SCORE_BANDS, scoreToBand } from '../scoring/scoring.constants.js';

export interface ComparableMetric {
  value: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
}

/** Orden canónico del flujo del estudio, para presentar el pipeline. */
const PIPELINE_ORDER = [
  'pendingFinancialStatements',
  'pendingStudyAnalysis',
  'studyCompleted',
  'pendingSignature',
  'confirmed',
  'rejected',
  'closed',
];

@Injectable()
export class DashboardService {
  constructor(private readonly repository: DashboardRepository) {}

  /**
   * Dashboard BÁSICO (home): solo lectura rápida accionable + UN gráfico.
   *  - summary: cartera, actividad del mes y saldo de consultas (lo primero que
   *    el cliente necesita saber: ¿puedo crear un estudio ahora?).
   *  - credit: $ solicitado vs $ avalado por Creditia en el mes.
   *  - pipeline: estudios por etapa del flujo (qué está atascado).
   *  - studiesByMonth: tendencia 6 meses (único gráfico).
   *  - recentStudies: últimos 5, con veredicto y score.
   *
   * Se eliminaron métricas de vanidad (total histórico de estudios, usuarios
   * activos, promedios de cupo/plazo, torta PN/PJ): no soportan decisiones.
   */
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
    // studyDate es DATE: el fin de mes inclusivo es el último instante previo al
    // arranque del mes siguiente.
    const endOfThisMonth = new Date(startOfNextMonth.getTime() - 1);
    const endOfPrevMonth = new Date(startOfThisMonth.getTime() - 1);

    const [
      totalCustomers,
      totalCustomersPrev,
      studiesThisMonth,
      studiesPrevMonth,
      creditCurrent,
      creditPrev,
      pipelineRaw,
      studiesByMonthRaw,
      recentStudiesRaw,
      packs,
    ] = await Promise.all([
      this.repository.countCustomers(companyId),
      this.repository.countCustomers(companyId, startOfThisMonth),
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
      this.repository.creditTotalsInRange(
        companyId,
        startOfThisMonth,
        endOfThisMonth,
      ),
      this.repository.creditTotalsInRange(
        companyId,
        startOfPrevMonth,
        endOfPrevMonth,
      ),
      this.repository.studiesByStatus(companyId),
      this.repository.studiesByMonth(companyId, 6),
      this.repository.recentStudies(companyId, 5),
      this.repository.activePacksBalance(companyId),
    ]);

    const pipeline = await this.buildPipeline(pipelineRaw);

    return {
      summary: {
        totalCustomers: this.compare(totalCustomers, totalCustomersPrev),
        studiesThisMonth: this.compare(studiesThisMonth, studiesPrevMonth),
        // ¿Puedo seguir operando? El número más accionable del home.
        analysisCredits: this.packBalance(packs),
      },
      credit: {
        totalRequestedThisMonth: this.compare(
          creditCurrent.totalRequested,
          creditPrev.totalRequested,
        ),
        totalApprovedThisMonth: this.compare(
          creditCurrent.totalApproved,
          creditPrev.totalApproved,
        ),
      },
      pipeline,
      studiesByMonth: this.fillMonths(studiesByMonthRaw, 6),
      recentStudies: recentStudiesRaw.map((s) => this.mapRecentStudy(s)),
    };
  }

  /**
   * Dashboard AVANZADO (con filtros de fecha): lo del básico a nivel de período
   * elegido + tasa de aprobación, score promedio, veredictos y perfil de riesgo
   * de la cartera según la central. 2 gráficos máximo (veredictos + tendencia).
   */
  async getAdvancedDashboard(companyId: string, filters: FilterDashboardDto) {
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : undefined;
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : undefined;
    const { effectiveFrom, effectiveTo, previousFrom, previousTo } =
      this.resolveRanges(dateFrom, dateTo);

    const [
      studiesCurrent,
      studiesPrev,
      verdictsCurrentRaw,
      verdictsPrevRaw,
      avgScoreCurrent,
      avgScorePrev,
      creditCurrent,
      creditPrev,
      pipelineRaw,
      bureauRows,
      totalCustomers,
      packs,
      studiesByMonthRaw,
      topCustomersByCredit,
      recentStudiesRaw,
    ] = await Promise.all([
      this.repository.countStudiesInRange(
        companyId,
        effectiveFrom,
        effectiveTo,
      ),
      this.repository.countStudiesInRange(companyId, previousFrom, previousTo),
      this.repository.verdictsInRange(companyId, dateFrom, dateTo),
      this.repository.verdictsInRange(companyId, previousFrom, previousTo),
      this.repository.avgViabilityScoreInRange(companyId, dateFrom, dateTo),
      this.repository.avgViabilityScoreInRange(
        companyId,
        previousFrom,
        previousTo,
      ),
      this.repository.creditTotalsInRange(companyId, dateFrom, dateTo),
      this.repository.creditTotalsInRange(companyId, previousFrom, previousTo),
      this.repository.studiesByStatus(companyId),
      this.repository.bureauRiskLatest(companyId),
      this.repository.countCustomers(companyId),
      this.repository.activePacksBalance(companyId),
      this.repository.studiesByMonth(companyId, 12),
      this.repository.topCustomersByCredit(companyId, 10, dateFrom, dateTo),
      this.repository.recentStudies(companyId, 8),
    ]);

    // ── Veredictos + tasa de aprobación (período vs período anterior) ──
    const verdictsCurrent = this.verdictCounts(verdictsCurrentRaw);
    const verdictsPrev = this.verdictCounts(verdictsPrevRaw);
    const approvalRate = this.compare(
      this.rate(verdictsCurrent),
      this.rate(verdictsPrev),
    );

    // ── Pipeline del flujo (accionable) ──
    const pipeline = await this.buildPipeline(pipelineRaw);

    // ── Riesgo de la cartera según la central ──
    const scores = bureauRows
      .map((r) => r.score)
      .filter((s): s is number => s !== null);
    const bandCounts = new Map<string, number>();
    for (const s of scores) {
      const band = scoreToBand(s);
      bandCounts.set(band.code, (bandCounts.get(band.code) ?? 0) + 1);
    }
    const bureauRisk = {
      avgScore:
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : null,
      consultedCustomers: bureauRows.length,
      // Clientes nunca consultados + consultados sin score = sin perfil de riesgo.
      withoutHistory:
        totalCustomers - bureauRows.length + (bureauRows.length - scores.length),
      withArrears: bureauRows.filter(
        (r) => r.saldoMora !== null && r.saldoMora > 0,
      ).length,
      byBand: SCORE_BANDS.map((b) => ({
        code: b.code,
        label: b.label,
        min: b.min,
        count: bandCounts.get(b.code) ?? 0,
      })),
    };

    return {
      period: {
        from: effectiveFrom,
        to: effectiveTo,
        previousFrom,
        previousTo,
      },
      kpis: {
        // ¿Puedo seguir operando? El número más accionable del dashboard.
        analysisCredits: this.packBalance(packs),
        studiesInPeriod: this.compare(studiesCurrent, studiesPrev),
        approvalRate, // % de analizados que salió approved/conditional
        avgViabilityScore: this.compare(
          Math.round(Number(avgScoreCurrent ?? 0)),
          Math.round(Number(avgScorePrev ?? 0)),
        ),
      },
      credit: {
        totalRequested: this.compare(
          creditCurrent.totalRequested,
          creditPrev.totalRequested,
        ),
        totalApproved: this.compare(
          creditCurrent.totalApproved,
          creditPrev.totalApproved,
        ),
        // % de lo solicitado que Creditia avaló (null si no hubo solicitudes).
        approvedOverRequestedPercent:
          creditCurrent.totalRequested > 0
            ? Number(
                (
                  (creditCurrent.totalApproved /
                    creditCurrent.totalRequested) *
                  100
                ).toFixed(1),
              )
            : null,
      },
      pipeline,
      verdicts: {
        approved: verdictsCurrent.approved,
        conditional: verdictsCurrent.conditional,
        rejected: verdictsCurrent.rejected,
        analyzed: verdictsCurrent.analyzed,
      },
      studiesByMonth: this.fillMonths(studiesByMonthRaw, 12),
      bureauRisk,
      topCustomersByCredit,
      recentStudies: recentStudiesRaw.map((s) => this.mapRecentStudy(s)),
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

  /** Saldo agregado de las bolsas activas: consultas restantes + vencimiento. */
  private packBalance(
    packs: Array<{
      quantityPurchased: number;
      quantityConsumed: number;
      endDate: Date;
    }>,
  ): { remaining: number; nearestExpiry: Date | null } {
    let remaining = 0;
    let nearestExpiry: Date | null = null;
    for (const p of packs) {
      const packRemaining = p.quantityPurchased - p.quantityConsumed;
      if (packRemaining <= 0) continue;
      remaining += packRemaining;
      if (!nearestExpiry || p.endDate < nearestExpiry) {
        nearestExpiry = p.endDate;
      }
    }
    return { remaining, nearestExpiry };
  }

  /** Estudios por etapa del flujo, ordenados por el orden canónico del proceso. */
  private async buildPipeline(
    raw: Array<{ statusId: number; _count: { id: number } }>,
  ) {
    const statusMeta = await this.repository.getParameterMeta(
      raw.map((s) => s.statusId),
    );
    return raw
      .map((s) => {
        const meta = statusMeta.get(s.statusId);
        return {
          statusId: s.statusId,
          code: meta?.code ?? 'unknown',
          label: meta?.label ?? 'Desconocido',
          count: s._count.id,
        };
      })
      .sort((a, b) => this.pipelineIndex(a.code) - this.pipelineIndex(b.code));
  }

  /** Fila de "estudios recientes" con el resultado del análisis a la vista. */
  private mapRecentStudy(s: {
    id: string;
    studyDate: Date;
    requestedCreditLine: number | null;
    recommendedCreditLine: number | null;
    viabilityScore: number | null;
    viabilityStatus: string | null;
    customer: { businessName: string };
    status: { id: number; code: string; label: string };
  }) {
    return {
      id: s.id,
      customerName: s.customer.businessName,
      studyDate: s.studyDate,
      statusCode: s.status.code,
      statusLabel: s.status.label,
      requestedCreditLine: s.requestedCreditLine,
      approvedCreditLine: s.recommendedCreditLine,
      viabilityScore: s.viabilityScore,
      viabilityStatus: s.viabilityStatus,
    };
  }

  /** Cuenta veredictos de un groupBy de viabilityStatus. */
  private verdictCounts(
    rows: Array<{ viabilityStatus: string | null; _count: { id: number } }>,
  ) {
    const get = (s: string) =>
      rows.find((r) => r.viabilityStatus === s)?._count.id ?? 0;
    const approved = get('approved');
    const conditional = get('conditional');
    const rejected = get('rejected');
    return {
      approved,
      conditional,
      rejected,
      analyzed: approved + conditional + rejected,
    };
  }

  /** Tasa de aprobación (%): approved+conditional sobre analizados. */
  private rate(v: {
    approved: number;
    conditional: number;
    analyzed: number;
  }): number {
    return v.analyzed > 0
      ? Number((((v.approved + v.conditional) / v.analyzed) * 100).toFixed(1))
      : 0;
  }

  private pipelineIndex(code: string): number {
    const i = PIPELINE_ORDER.indexOf(code);
    return i === -1 ? PIPELINE_ORDER.length : i;
  }

  private resolveRanges(
    dateFrom?: Date,
    dateTo?: Date,
  ): {
    effectiveFrom: Date;
    effectiveTo: Date;
    previousFrom: Date;
    previousTo: Date;
  } {
    const now = new Date();
    const effectiveTo = dateTo ?? now;
    const effectiveFrom =
      dateFrom ??
      new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    const spanMs = effectiveTo.getTime() - effectiveFrom.getTime();
    const previousTo = new Date(effectiveFrom.getTime());
    const previousFrom = new Date(effectiveFrom.getTime() - spanMs);

    return { effectiveFrom, effectiveTo, previousFrom, previousTo };
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
}
