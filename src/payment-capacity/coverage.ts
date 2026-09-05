// ─── Cobertura de la ventana de extractos (§2/§3 del diseño) ───────────────
// Asalariado: 3 meses de extractos + desprendible(s). Independiente: 3 meses
// (los extractos son su única prueba de ingreso, pero exigir 6 hundía la tasa
// de radicación; quien aporte más, se promedia sobre más).
// Un PDF puede cubrir varios meses (Bancolombia trimestral), así que la unidad
// de cobertura es el MES calendario, no el archivo. Habilita el paso a
// "pendiente de análisis" y el botón Analizar del front.

import {
  WINDOW_MONTHS_INDEPENDENT,
  WINDOW_MONTHS_SALARIED,
} from './engine/payment-capacity.constants.js';

/** Corte más reciente aceptable (días desde el fin del último extracto). */
export const STATEMENT_RECENCY_DAYS = 45;

export interface CoverageInfo {
  requiredMonths: number;
  coveredMonths: number;
  /** Meses cubiertos (YYYY-MM), ordenados. */
  months: string[];
  /** Fin del extracto más reciente (ISO) o null. */
  lastPeriodTo: string | null;
  /** ¿El extracto más reciente tiene corte ≤ STATEMENT_RECENCY_DAYS? */
  recencyOk: boolean | null;
  payrollStubs: number;
  contractorInvoices: number;
  /** Asalariado sin ningún desprendible → false hasta que aporte al menos 1. */
  incomeDocOk: boolean;
  /** ¿Se puede pasar a análisis? (extractos completos + doc de ingreso). */
  complete: boolean;
}

/**
 * Días de un mes que un extracto debe cubrir para que el mes cuente. Los
 * extractos trimestrales de Bancolombia arrancan en el corte anterior
 * (2026-03-31 → 2026-06-30): tocar el calendario de marzo por UN día no es
 * cubrir marzo. Sin este umbral el mes entra igual, infla `coveredMonths` y
 * todos los promedios mensuales se dividen entre un mes que no existe —
 * además de fabricar un "mes sin ingreso" que dispara la volatilidad.
 */
export const MIN_DAYS_TO_COVER_MONTH = 15;

const DAY = 86_400_000;
const monthStart = (month: string) => Date.parse(`${month}-01T00:00:00Z`);
const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Meses (YYYY-MM) REALMENTE cubiertos por un rango de fechas ISO: los que el
 * rango cubre por al menos MIN_DAYS_TO_COVER_MONTH días, o por completo si el
 * mes es más corto que el umbral (no ocurre, pero evita un borde absurdo).
 */
export function monthsInRange(fromIso: string, toIso: string): string[] {
  const fromMs = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const toMs = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return [];

  const months: string[] = [];
  const cursor = new Date(`${fromIso.slice(0, 7)}-01T00:00:00Z`);
  const last = `${toIso.slice(0, 7)}`;
  for (;;) {
    const month = cursor.toISOString().slice(0, 7);
    const total = daysInMonth(month);
    const start = monthStart(month);
    const end = start + (total - 1) * DAY;
    // Días del mes dentro del rango (ambos extremos inclusive).
    const overlapFrom = Math.max(start, fromMs);
    const overlapTo = Math.min(end, toMs);
    const covered =
      overlapTo >= overlapFrom
        ? Math.round((overlapTo - overlapFrom) / DAY) + 1
        : 0;
    if (covered >= Math.min(MIN_DAYS_TO_COVER_MONTH, total)) {
      months.push(month);
    }
    if (month === last) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** Mes calendario anterior a uno dado ('2026-03' → '2026-02'). */
export function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 2, 1)).toISOString().slice(0, 7);
}

/**
 * ¿Un desprendible del período dado acredita el ingreso de la ventana? Se
 * acepta cualquier mes cubierto por los extractos y el inmediatamente anterior
 * al primero (desfase natural entre el corte de nómina y el del extracto).
 * Sin extractos todavía no hay contra qué medir: no se puede afirmar que no.
 */
export function isPayrollPeriodCurrent(
  period: string | null,
  coveredMonths: string[],
): boolean {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return true;
  if (coveredMonths.length === 0) return true;
  const accepted = new Set(coveredMonths);
  accepted.add(previousMonth(coveredMonths[0]));
  return accepted.has(period);
}

export function computeCoverage(params: {
  employmentType: 'salaried' | 'independent';
  statementPeriods: Array<{ from: string | null; to: string | null }>;
  payrollStubs: number;
  contractorInvoices: number;
  now?: Date;
}): CoverageInfo {
  const requiredMonths =
    params.employmentType === 'independent'
      ? WINDOW_MONTHS_INDEPENDENT
      : WINDOW_MONTHS_SALARIED;

  const monthSet = new Set<string>();
  let lastPeriodTo: string | null = null;
  for (const period of params.statementPeriods) {
    if (!period.from || !period.to) continue;
    for (const month of monthsInRange(period.from, period.to)) {
      monthSet.add(month);
    }
    if (!lastPeriodTo || period.to > lastPeriodTo) lastPeriodTo = period.to;
  }
  const months = [...monthSet].sort();

  const now = params.now ?? new Date();
  const recencyOk = lastPeriodTo
    ? (now.getTime() - Date.parse(lastPeriodTo)) / 86_400_000 <=
      STATEMENT_RECENCY_DAYS
    : null;

  // El documento de ingreso del asalariado es el desprendible (mínimo 1 para
  // analizar; 2 recomendados — el faltante se declara como flag, no bloquea).
  // El del independiente es opcional (facturas): sus extractos ampliados bastan.
  const incomeDocOk =
    params.employmentType === 'salaried' ? params.payrollStubs >= 1 : true;

  return {
    requiredMonths,
    coveredMonths: months.length,
    months,
    lastPeriodTo,
    recencyOk,
    payrollStubs: params.payrollStubs,
    contractorInvoices: params.contractorInvoices,
    incomeDocOk,
    complete: months.length >= requiredMonths && incomeDocOk,
  };
}
