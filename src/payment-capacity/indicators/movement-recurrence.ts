// ─── Análisis de recurrencia sobre los movimientos del extracto ────────────
// El prompt etiqueta la categoría BASE de cada movimiento; aquí se decide la
// clasificación fina (doc de extracción §3, notas): qué es ingreso de verdad,
// qué cuota probable, qué gasto fijo. Módulo puro: sin IO, sin Nest — igual
// que financial-indicators en el flujo EEFF.

import type {
  BankMovement,
  BankStatementExtraction,
  MovementCategory,
} from '../extraction/extraction.types.js';

/** Categorías que cuentan como INGRESO (self-transfer y avances TC jamás). */
export const INCOME_CATEGORIES: ReadonlySet<MovementCategory> = new Set([
  'income_international',
  'income_payroll',
  'income_other',
]);

/**
 * Compromisos fijos: gasto contractual que NO se baja de un mes a otro
 * (§4.2). Restan del ingreso disponible porque el titular no puede dejar de
 * pagarlos para atender una cuota nueva.
 */
const FIXED_COMMITMENT_CATEGORIES: ReadonlySet<MovementCategory> = new Set([
  'utilities',
  'telecom',
  'health',
  'education',
  'insurance',
  'rent',
  'subscription',
  'bank_fee',
]);

/**
 * Costo de vida: gasto real pero COMPRIMIBLE. A propósito NO resta del
 * disponible — la subsistencia ya la protege el tope del 30% del ingreso en la
 * cuota máxima, y restarlo además cobraría dos veces la misma protección. Se
 * reporta para que el analista vea de qué tamaño es el tren de vida.
 */
const LIVING_COST_CATEGORIES: ReadonlySet<MovementCategory> = new Set([
  'groceries',
  'transport',
  'purchase',
  'atm_withdrawal',
]);

/** Abonos que nombran la tarjeta de crédito: "TRANSFERENCIA TC SUC VIRTUAL" es
 *  un avance, no plata propia — pero se diferencia de "TRANSFERENCIA CTA SUC
 *  VIRTUAL" (traslado entre cuentas del titular) en dos letras, y el prompt las
 *  confundía. "SALDO A FAVOR" queda por fuera: eso es una devolución de la
 *  tarjeta, no un avance. */
const CARD_CASH_IN_RE = /\b(TC|AVANCE|TARJETA(\s+DE)?\s+CR[EÉ]DITO)\b/i;
const CARD_REFUND_RE = /SALDO\s+A\s+FAVOR/i;

/**
 * ¿Este abono es un avance de tarjeta? No es ingreso ni traslado propio: es
 * deuda nueva entrando a la cuenta, y de las señales de estrés más fuertes que
 * da un extracto. Se decide en código y no solo por la categoría del prompt.
 */
export function isCardCashIn(mv: BankMovement): boolean {
  if (mv.amount <= 0) return false;
  if (CARD_REFUND_RE.test(mv.rawDescription)) return false;
  return (
    mv.category === 'cc_cash_in' || CARD_CASH_IN_RE.test(mv.rawDescription)
  );
}

export const monthKey = (dateIso: string) => dateIso.slice(0, 7);

/** Punto de la serie mensual de ingreso. */
export interface MonthlyIncomePoint {
  month: string;
  income: number;
  /** Nº de abonos clasificados como ingreso en el mes. */
  deposits: number;
}

/**
 * Serie mensual de ingreso sobre los meses de la ventana. Un mes cubierto por
 * extractos pero sin abonos de ingreso cuenta como 0 (eso ES la señal de
 * volatilidad, no un dato faltante).
 */
export function monthlyIncomeSeries(
  movements: BankMovement[],
  months: string[],
): MonthlyIncomePoint[] {
  const byMonth = new Map<string, { income: number; deposits: number }>(
    months.map((m) => [m, { income: 0, deposits: 0 }]),
  );
  for (const mv of movements) {
    if (mv.amount <= 0 || !INCOME_CATEGORIES.has(mv.category)) continue;
    if (isCardCashIn(mv)) continue; // un avance de TC nunca es ingreso
    const bucket = byMonth.get(monthKey(mv.date));
    if (!bucket) continue; // fuera de la ventana (no debería, V6 lo declara)
    bucket.income += mv.amount;
    bucket.deposits += 1;
  }
  return months.map((month) => ({ month, ...byMonth.get(month)! }));
}

/** Promedio y coeficiente de variación de una serie (CV = σ/μ; null si μ=0). */
export function seriesStats(values: number[]): {
  mean: number;
  cv: number | null;
} {
  if (values.length === 0) return { mean: 0, cv: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return { mean: 0, cv: null };
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, cv: Math.sqrt(variance) / mean };
}

/** Total pagado a una contraparte en un mes de la ventana (0 incluido). */
export interface ObligationMonth {
  month: string;
  amount: number;
}

/** Obligación detectada en el extracto (alimenta cuotas + narrativa). */
export interface DetectedObligation {
  kind: 'loan' | 'card' | 'probable_installment';
  /** Etiqueta REAL del extracto (la variante más frecuente), nunca una cadena
   *  normalizada: una fila que no se pueda encontrar en el PDF no se puede
   *  verificar, y quien lee el informe tiene el extracto al lado. */
  counterparty: string;
  /** De dónde sale: el extracto o el desprendible (libranzas y embargos). */
  source: 'statement' | 'payrollStub';
  /** Suma de los pagos del período: la cifra que SÍ aparece en el extracto. */
  totalAmount: number;
  paymentCount: number;
  /** Total mes a mes de la ventana, con los meses en cero incluidos: es lo que
   *  hace evidente de dónde sale el promedio. */
  monthlyTotals: ObligationMonth[];
  /** totalAmount ÷ meses de la ventana. */
  monthlyAverage: number;
  /** Meses (YYYY-MM) con al menos un pago. */
  months: string[];
  confidence: 'high' | 'medium';
  detail: string;
}

const obligationLabel = (mv: BankMovement) =>
  (mv.counterparty ?? mv.rawDescription).trim().toUpperCase();

/**
 * Formas societarias: el banco escribe al mismo acreedor de varias maneras
 * ("FINESA S.A." y "FINESA S A", "P.A. ADDI" y "P A ADDI"). Sin quitarlas, un
 * único acreedor sale partido en dos filas y ninguna muestra su cuota real.
 * SAS va antes que SA: si no, "SAS" perdería solo "SA" y dejaría una "S" suelta.
 */
const LEGAL_FORM_RE = /\b(S\s?A\s?S|S\s?A|LTDA|S\s?EN\s?C)\b/g;

/** Clave de agrupación. Solo agrupa variantes del MISMO nombre: dos acreedores
 *  distintos jamás se mezclan, cada uno conserva su fila y su cuota. */
export function normalizeCounterparty(label: string): string {
  const normalized = label
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[.,;:*#/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEGAL_FORM_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Un nombre que era SOLO la forma societaria quedaría vacío: se conserva crudo.
  return normalized || label.trim().toUpperCase();
}

/** De las variantes agrupadas, la que más veces aparece (desempate: la más
 *  larga). Se muestra tal cual la escribió el banco. */
function displayLabel(group: BankMovement[]): string {
  const counts = new Map<string, number>();
  for (const mv of group) {
    const raw = obligationLabel(mv);
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length,
  )[0][0];
}

const fmtMoney = (v: number) => Math.round(v).toLocaleString('es-CO');

/**
 * Reparte los pagos de una contraparte por mes y arma el resumen que se muestra:
 * total del período, desglose mes a mes y promedio. Antes solo se emitía el
 * promedio, y un pago único de $734.714 salía impreso como $244.905 — una cifra
 * que no está en ninguna parte del extracto y que nadie puede cuadrar.
 * Los movimientos fuera de la ventana no entran: así el total SIEMPRE es la
 * suma del desglose.
 */
function summarizePayments(group: BankMovement[], windowMonths: string[]) {
  const byMonth = new Map(windowMonths.map((m) => [m, 0]));
  let paymentCount = 0;
  for (const mv of group) {
    const key = monthKey(mv.date);
    const current = byMonth.get(key);
    if (current === undefined) continue;
    byMonth.set(key, current + Math.abs(mv.amount));
    paymentCount += 1;
  }
  const monthlyTotals: ObligationMonth[] = windowMonths.map((month) => ({
    month,
    amount: byMonth.get(month)!,
  }));
  const totalAmount = monthlyTotals.reduce((a, m) => a + m.amount, 0);
  const divisor = Math.max(windowMonths.length, 1);
  return {
    totalAmount,
    paymentCount,
    monthlyTotals,
    monthlyAverage: totalAmount / divisor,
    months: monthlyTotals.filter((m) => m.amount > 0).map((m) => m.month),
  };
}

/** Frase que permite cuadrar la fila contra el PDF: cuántos pagos, cuánto
 *  suman y de dónde sale el promedio (la división, escrita). */
const reconciliation = (
  totalAmount: number,
  paymentCount: number,
  monthsWithPayments: number,
  windowCount: number,
): string =>
  `${paymentCount} pago(s) por $${fmtMoney(totalAmount)} en ${monthsWithPayments} de los ${windowCount} mes(es) del extracto. ` +
  `Promedio mensual: $${fmtMoney(totalAmount)} ÷ ${windowCount} = $${fmtMoney(totalAmount / Math.max(windowCount, 1))}.`;

/**
 * Descripciones que nombran el CANAL, no a un beneficiario ("TRANSFERENCIA CTA
 * SUC VIRTUAL"). Sin alguien al otro lado no hay a quién deberle: tratarlas
 * como cuota inventa deuda — el titular normalmente está moviendo plata entre
 * sus propias cuentas. Cinturón en código por si el prompt no las clasificó
 * como self_transfer_out. Ojo: los traslados a OTRA entidad ("TRASLADO VIRTUAL
 * OTROS BANCOS") sí siguen contando, porque la plata sale del banco.
 */
const GENERIC_CHANNEL_RE =
  /^(TRANSFERENCIA|TRANSF)\s+(CTA|CUENTA)\s+(SUC|SUCURSAL)\s+VIRTUAL$/;

const namesNoCounterparty = (label: string): boolean =>
  GENERIC_CHANNEL_RE.test(label.replace(/\s+/g, ' ').trim());

/**
 * Detecta las obligaciones financieras del extracto (§4.3 y doc de extracción
 * §3): `loan_payment` es cuota cierta; `cc_payment` es servicio de tarjeta
 * (sale real de la cuenta: las compras con TC no pasan por el extracto, solo su
 * pago); `recurring_transfer_out` con monto idéntico en ≥2 meses es cuota
 * PROBABLE en otra entidad ($1,104,600.00 exacto tres meses seguidos no es un
 * gasto casual).
 */
export function detectObligations(
  movements: BankMovement[],
  windowMonths: string[],
): DetectedObligation[] {
  const windowCount = Math.max(windowMonths.length, 1);
  const obligations: DetectedObligation[] = [];

  const groupBy = (category: MovementCategory) => {
    const groups = new Map<string, BankMovement[]>();
    for (const mv of movements) {
      if (mv.category !== category || mv.amount >= 0) continue;
      const key = normalizeCounterparty(obligationLabel(mv));
      groups.set(key, [...(groups.get(key) ?? []), mv]);
    }
    return groups;
  };

  for (const group of groupBy('loan_payment').values()) {
    const summary = summarizePayments(group, windowMonths);
    if (summary.paymentCount === 0) continue;
    obligations.push({
      kind: 'loan',
      counterparty: displayLabel(group),
      source: 'statement',
      ...summary,
      confidence: 'high',
      detail: `${reconciliation(summary.totalAmount, summary.paymentCount, summary.months.length, windowCount)} Cuota de crédito: cuenta como deuda y puede no estar reportada en la central.`,
    });
  }

  for (const group of groupBy('cc_payment').values()) {
    const summary = summarizePayments(group, windowMonths);
    if (summary.paymentCount === 0) continue;
    obligations.push({
      kind: 'card',
      counterparty: displayLabel(group),
      source: 'statement',
      ...summary,
      confidence: 'high',
      detail: `${reconciliation(summary.totalAmount, summary.paymentCount, summary.months.length, windowCount)} NO se cuenta como cuota de deuda: el extracto no distingue el pago mínimo (deuda) del pago total (consumo del mes).`,
    });
  }

  // Cuota probable: misma contraparte + mismo monto (±1%) en ≥2 meses distintos.
  const recurringGroups = new Map<string, BankMovement[]>();
  for (const mv of movements) {
    if (mv.category !== 'recurring_transfer_out' || mv.amount >= 0) continue;
    const label = obligationLabel(mv);
    if (namesNoCounterparty(label)) continue;
    const key = normalizeCounterparty(label);
    recurringGroups.set(key, [...(recurringGroups.get(key) ?? []), mv]);
  }
  for (const group of recurringGroups.values()) {
    // Subagrupar por monto con tolerancia del 1%.
    const amountGroups: BankMovement[][] = [];
    for (const mv of group) {
      const match = amountGroups.find(
        (g) =>
          Math.abs(Math.abs(g[0].amount) - Math.abs(mv.amount)) <=
          Math.abs(g[0].amount) * 0.01,
      );
      if (match) match.push(mv);
      else amountGroups.push([mv]);
    }
    for (const g of amountGroups) {
      const summary = summarizePayments(g, windowMonths);
      if (summary.months.length < 2) continue;
      const amount = Math.abs(g[0].amount);
      obligations.push({
        kind: 'probable_installment',
        counterparty: displayLabel(g),
        source: 'statement',
        ...summary,
        confidence: 'medium',
        detail: `${reconciliation(summary.totalAmount, summary.paymentCount, summary.months.length, windowCount)} Es siempre el mismo monto ($${fmtMoney(amount)}) a la misma contraparte: parece un compromiso fijo, pero el extracto no dice de qué. Verifíquelo antes de darlo por deuda.`,
      });
    }
  }

  return obligations.sort((a, b) => b.monthlyAverage - a.monthlyAverage);
}

const monthlyAverageOf = (
  movements: BankMovement[],
  categories: ReadonlySet<MovementCategory>,
  windowMonths: number,
): number => {
  const divisor = Math.max(windowMonths, 1);
  const total = movements
    .filter((m) => m.amount < 0 && categories.has(m.category))
    .reduce((a, m) => a + Math.abs(m.amount), 0);
  return total / divisor;
};

/** Promedio mensual de los compromisos fijos (arriendo, salud, educación,
 *  servicios, telecom, seguros, suscripciones, cuotas de manejo). Los impuestos
 *  (4x1000) se excluyen: fricción, no gasto elegido. */
export function recurringFixedExpensesMonthly(
  movements: BankMovement[],
  windowMonths: number,
): number {
  return monthlyAverageOf(movements, FIXED_COMMITMENT_CATEGORIES, windowMonths);
}

/** Promedio mensual del costo de vida observado (mercado, transporte, compras,
 *  retiros). Se REPORTA; no entra en el cálculo del disponible. */
export function livingCostMonthly(
  movements: BankMovement[],
  windowMonths: number,
): number {
  return monthlyAverageOf(movements, LIVING_COST_CATEGORIES, windowMonths);
}

/** Señales de comportamiento financiero (§4.4). */
export interface BehaviorSignals {
  /** Promedio de los saldos promedio que reporta el banco (si los trae). */
  averageBalance: number | null;
  minBalance: number | null;
  /** Días con saldo estrictamente negativo (aprox. por saldo corrido). */
  daysNegative: number;
  /** Días con saldo exactamente en cero. */
  daysAtZero: number;
  /** % promedio del abono de ingreso retirado en las 48h siguientes. */
  pctWithdrawn48h: number | null;
  gamblingMonthlyAvg: number;
  gamblingPctOfIncome: number | null;
  walletTransfersMonthlyAvg: number;
  walletTransfersCount: number;
  /** Avances de TC hacia la cuenta (cc_cash_in): señal de estrés, no ingreso. */
  cardCashInTotal: number;
}

const DAY_MS = 86_400_000;

/**
 * Señales de comportamiento sobre los extractos. Los días en negativo/cero se
 * aproximan con el saldo corrido: el saldo de un movimiento rige hasta el
 * siguiente movimiento (o el fin del período del extracto).
 */
export function behaviorSignals(
  statements: BankStatementExtraction[],
  monthlyIncomeAvg: number,
  windowMonths: number,
): BehaviorSignals {
  const divisor = Math.max(windowMonths, 1);
  const allMovements = statements.flatMap((s) => s.movements);

  const bankAverages = statements
    .map((s) => s.summary.averageBalance)
    .filter((v): v is number => v != null);
  const averageBalance =
    bankAverages.length > 0
      ? bankAverages.reduce((a, b) => a + b, 0) / bankAverages.length
      : null;

  let minBalance: number | null = null;
  let daysNegative = 0;
  let daysAtZero = 0;
  for (const st of statements) {
    const sorted = [...st.movements].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    for (let i = 0; i < sorted.length; i++) {
      const balance = sorted[i].balance;
      if (minBalance === null || balance < minBalance) minBalance = balance;
      const from = Date.parse(sorted[i].date);
      const to =
        i + 1 < sorted.length
          ? Date.parse(sorted[i + 1].date)
          : Date.parse(st.period.to) + DAY_MS;
      const days = Math.max(Math.round((to - from) / DAY_MS), 1);
      if (balance < 0) daysNegative += days;
      else if (balance === 0) daysAtZero += days;
    }
  }

  // Retiro inmediato: por cada abono de ingreso, % retirado en las 48h
  // siguientes (cargos de cualquier categoría, tope 100% del abono).
  const ratios: number[] = [];
  for (const st of statements) {
    const income = st.movements.filter(
      (m) => m.amount > 0 && INCOME_CATEGORIES.has(m.category),
    );
    for (const dep of income) {
      const start = Date.parse(dep.date);
      const withdrawn = st.movements
        .filter((m) => {
          if (m.amount >= 0) return false;
          const t = Date.parse(m.date);
          return t >= start && t - start <= 2 * DAY_MS;
        })
        .reduce((a, m) => a + Math.abs(m.amount), 0);
      ratios.push(Math.min(withdrawn / dep.amount, 1));
    }
  }
  const pctWithdrawn48h =
    ratios.length > 0
      ? ratios.reduce((a, b) => a + b, 0) / ratios.length
      : null;

  const gamblingTotal = allMovements
    .filter((m) => m.amount < 0 && m.category === 'gambling')
    .reduce((a, m) => a + Math.abs(m.amount), 0);
  const gamblingMonthlyAvg = gamblingTotal / divisor;

  const wallet = allMovements.filter(
    (m) => m.amount < 0 && m.category === 'wallet_transfer',
  );
  const walletTotal = wallet.reduce((a, m) => a + Math.abs(m.amount), 0);

  const cardCashInTotal = allMovements
    .filter(isCardCashIn)
    .reduce((a, m) => a + m.amount, 0);

  return {
    averageBalance,
    minBalance,
    daysNegative,
    daysAtZero,
    pctWithdrawn48h,
    gamblingMonthlyAvg,
    gamblingPctOfIncome:
      monthlyIncomeAvg > 0 ? gamblingMonthlyAvg / monthlyIncomeAvg : null,
    walletTransfersMonthlyAvg: walletTotal / divisor,
    walletTransfersCount: wallet.length,
    cardCashInTotal,
  };
}
