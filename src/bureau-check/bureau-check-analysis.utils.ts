// Piezas PURAS del análisis de la consulta de riesgo: el contraste de monto
// (determinístico, nunca IA), la validación/saneo del JSON del modelo y los
// derivados del snapshot (comportamiento, tendencia, totales, identidad).

import { round2 } from '../common/utils/format.utils.js';
import type {
  MappedCreditSector,
  MappedPaymentBehaviorItem,
  MappedBalanceEvolutionPoint,
} from '../credit-bureau/providers/provider-result.js';

/** Contraste monto solicitado vs sugerido por la central. */
export interface AmountComparison {
  requested: number | null;
  suggested: number | null;
  ratio: number | null;
  verdict: 'within' | 'above' | 'far_above' | 'not_comparable';
  verdictLabel: string;
}

export interface BureauCheckFlag {
  severity: 'warning' | 'danger';
  title: string;
  detail: string;
}

export interface BureauCheckSignal {
  title: string;
  detail: string;
}

export interface BureauCheckRecommendation {
  title: string;
  detail: string;
}

export interface NormalizedAnalysis {
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  redFlags: BureauCheckFlag[];
  positiveSignals: BureauCheckSignal[];
  sections: {
    indebtedness: string;
    paymentHabits: string;
    alerts: string;
    income: string;
  };
  recommendations: BureauCheckRecommendation[];
}

export function buildAmountComparison(
  requested: number | null,
  suggested: number | null,
): AmountComparison {
  const base = { requested: requested ?? null, suggested: suggested ?? null };
  if (requested == null || requested <= 0) {
    return {
      ...base,
      ratio: null,
      verdict: 'not_comparable',
      verdictLabel: 'No se indicó monto solicitado.',
    };
  }
  if (suggested == null || suggested <= 0) {
    return {
      ...base,
      ratio: null,
      verdict: 'not_comparable',
      verdictLabel: 'La central no sugiere un monto de referencia.',
    };
  }
  const ratio = round2(requested / suggested);
  if (ratio <= 1) {
    return {
      ...base,
      ratio,
      verdict: 'within',
      verdictLabel:
        'El monto solicitado está dentro del monto sugerido por la central.',
    };
  }
  if (ratio <= 1.5) {
    return {
      ...base,
      ratio,
      verdict: 'above',
      verdictLabel: `El monto solicitado supera el sugerido por la central (${ratio}x).`,
    };
  }
  return {
    ...base,
    ratio,
    verdict: 'far_above',
    verdictLabel: `El monto solicitado supera ampliamente el sugerido por la central (${ratio}x).`,
  };
}

/**
 * Valida y sanea el JSON del modelo. Estricto en lo estructural (summary y
 * riskLevel obligan reintento), tolerante en las listas (se filtra lo malformado).
 */
export function normalizeAnalysis(
  parsed: Record<string, unknown>,
): NormalizedAnalysis {
  const summary =
    typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  const riskLevel = parsed.riskLevel;
  if (!summary || !['low', 'medium', 'high'].includes(riskLevel as string)) {
    throw new Error(
      'La respuesta del modelo no tiene el formato esperado. Intente de nuevo.',
    );
  }

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const flags: BureauCheckFlag[] = Array.isArray(parsed.redFlags)
    ? (parsed.redFlags as unknown[])
        .map((f) => {
          const o = (f ?? {}) as Record<string, unknown>;
          return {
            severity:
              o.severity === 'danger'
                ? ('danger' as const)
                : ('warning' as const),
            title: str(o.title),
            detail: str(o.detail),
          };
        })
        .filter((f) => f.title || f.detail)
    : [];
  const signals: BureauCheckSignal[] = Array.isArray(parsed.positiveSignals)
    ? (parsed.positiveSignals as unknown[])
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return { title: str(o.title), detail: str(o.detail) };
        })
        .filter((s) => s.title || s.detail)
    : [];
  const rawSections = (parsed.sections ?? {}) as Record<string, unknown>;
  const recommendations: BureauCheckRecommendation[] = Array.isArray(
    parsed.recommendations,
  )
    ? (parsed.recommendations as unknown[])
        .map((r) => {
          const o = (r ?? {}) as Record<string, unknown>;
          return { title: str(o.title), detail: str(o.detail) };
        })
        .filter((r) => r.title || r.detail)
    : [];

  return {
    summary,
    riskLevel: riskLevel as NormalizedAnalysis['riskLevel'],
    redFlags: flags,
    positiveSignals: signals,
    sections: {
      indebtedness: str(rawSections.indebtedness),
      paymentHabits: str(rawSections.paymentHabits),
      alerts: str(rawSections.alerts),
      income: str(rawSections.income),
    },
    recommendations,
  };
}

// ── Derivados del snapshot (código, nunca IA) ───────────────────────────────

/** Punto de la línea de tiempo de comportamiento (Tabla 9, transformada). */
export interface PaymentTimelinePoint {
  month: string | null; // 'YYYY-MM'
  code: string | null;
  label: string | null;
  status: 'ok' | 'delay' | 'severe' | 'unknown';
}

export interface PaymentStats {
  monthsWithData: number;
  onTimePct: number | null; // % de meses al día sobre los meses con dato
  delayMonths: number; // meses con alguna mora
  worstLabel: string | null; // peor comportamiento observado
  lastDelayMonth: string | null; // mora más reciente ('YYYY-MM')
}

// Severidad por código Tabla 9: N al día; 1-2 mora temprana; 3-6/C/D serias.
const SEVERE_CODES = new Set(['3', '4', '5', '6', 'C', 'D']);
const DELAY_CODES = new Set(['1', '2']);

function behaviorStatus(code: string | null): PaymentTimelinePoint['status'] {
  if (code === 'N') return 'ok';
  if (code !== null && DELAY_CODES.has(code)) return 'delay';
  if (code !== null && SEVERE_CODES.has(code)) return 'severe';
  return 'unknown';
}

/** Línea de tiempo cronológica (máx. 24 meses recientes) en formato propio. */
export function buildPaymentTimeline(
  behavior: MappedPaymentBehaviorItem[] | null,
): PaymentTimelinePoint[] {
  if (!behavior?.length) return [];
  return [...behavior]
    .sort((a, b) => (a.anioMes ?? '').localeCompare(b.anioMes ?? ''))
    .slice(-24)
    .map((b) => ({
      month: b.anioMes,
      code: b.comportamiento,
      label: b.comportamientoLabel,
      status: behaviorStatus(b.comportamiento),
    }));
}

/** Estadísticas del hábito de pago sobre los meses CON dato. */
export function buildPaymentStats(
  timeline: PaymentTimelinePoint[],
): PaymentStats | null {
  const known = timeline.filter((p) => p.status !== 'unknown');
  if (known.length === 0) return null;

  const okCount = known.filter((p) => p.status === 'ok').length;
  const delays = known.filter((p) => p.status !== 'ok');
  // Peor comportamiento: D/C pesan más que 6..1 (orden de castigo real).
  const rank = (code: string | null): number => {
    if (code === 'D') return 8;
    if (code === 'C') return 7;
    const n = Number(code);
    return Number.isNaN(n) ? 0 : n;
  };
  const worst = delays.reduce(
    (acc: PaymentTimelinePoint | null, p) =>
      acc === null || rank(p.code) > rank(acc.code) ? p : acc,
    null,
  );
  const lastDelay = delays.length > 0 ? delays[delays.length - 1] : null;

  return {
    monthsWithData: known.length,
    onTimePct: round2((okCount / known.length) * 100),
    delayMonths: delays.length,
    worstLabel: worst?.label ?? worst?.code ?? null,
    lastDelayMonth: lastDelay?.month ?? null,
  };
}

/** Tendencia del saldo entre el primer y el último trimestre reportado. */
export interface BalanceTrend {
  direction: 'down' | 'stable' | 'up';
  label: string;
}

export function buildBalanceTrend(
  points: MappedBalanceEvolutionPoint[] | null,
): BalanceTrend | null {
  const withSaldo = (points ?? []).filter(
    (p): p is MappedBalanceEvolutionPoint & { saldo: number } =>
      typeof p.saldo === 'number',
  );
  if (withSaldo.length < 2) return null;
  const first = withSaldo[0].saldo;
  const last = withSaldo[withSaldo.length - 1].saldo;
  if (first <= 0) return null;
  const changePct = ((last - first) / first) * 100;
  if (changePct <= -10) {
    return {
      direction: 'down',
      label: 'Endeudamiento a la baja en los últimos trimestres.',
    };
  }
  if (changePct >= 10) {
    return {
      direction: 'up',
      label: 'Endeudamiento al alza en los últimos trimestres.',
    };
  }
  return {
    direction: 'stable',
    label: 'Endeudamiento estable en los últimos trimestres.',
  };
}

/** Totales sobre los sectores (la central manda los 4 aunque estén en cero). */
export interface SectorTotals {
  vigentes: number;
  cerrados: number;
  valorCuota: number | null; // null si ningún sector trae el dato
  totalCodeudorOtros: number | null;
}

export function buildSectorTotals(
  sectors: MappedCreditSector[] | null,
): SectorTotals {
  const list = sectors ?? [];
  const sumOrNull = (values: Array<number | null>): number | null => {
    const known = values.filter((v): v is number => typeof v === 'number');
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
  };
  return {
    vigentes: list.reduce((a, s) => a + (Number(s.creditosVigentes) || 0), 0),
    cerrados: list.reduce((a, s) => a + (Number(s.creditosCerrados) || 0), 0),
    valorCuota: sumOrNull(list.map((s) => s.valorCuota)),
    totalCodeudorOtros: sumOrNull(list.map((s) => s.totalCodeudorOtros)),
  };
}

/**
 * Match tolerante entre el nombre digitado por el usuario y el registrado en la
 * central: sin tildes ni mayúsculas, basta con que todos los tokens digitados
 * aparezcan en el nombre de la central (se puede digitar solo apellidos).
 */
export function namesMatch(
  typed: string | null,
  central: string | null,
): boolean | null {
  const tokens = (v: string): string[] =>
    v
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-zñ]+/)
      .filter((t) => t.length > 1);
  const t = typed ? tokens(typed) : [];
  const c = central ? tokens(central) : [];
  if (t.length === 0 || c.length === 0) return null;
  const centralSet = new Set(c);
  return t.every((token) => centralSet.has(token));
}
