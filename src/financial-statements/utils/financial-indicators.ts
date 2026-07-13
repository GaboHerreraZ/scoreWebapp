import { getMonthsFromPeriod } from '../../common/enums/income-statement-period.enum.js';

/**
 * Cifras crudas de un estado financiero necesarias para derivar los indicadores.
 * Coinciden con las columnas crudas de FinancialStatement.
 */
export interface FinancialStatementRawFigures {
  totalCurrentAssets?: number | null;
  totalCurrentLiabilities?: number | null;
  totalAssets?: number | null;
  retainedEarnings?: number | null;
  grossProfit?: number | null;
  administrativeExpenses?: number | null;
  sellingExpenses?: number | null;
  equity?: number | null;
  totalLiabilities?: number | null;
  ordinaryActivityRevenue?: number | null;
  costOfSales?: number | null;
  depreciation?: number | null;
  amortization?: number | null;
  shortTermFinancialLiabilities?: number | null;
  longTermFinancialLiabilities?: number | null;
  financialExpenses?: number | null;
  netIncome?: number | null;
  accountsReceivable1?: number | null;
  accountsReceivable2?: number | null;
  inventories1?: number | null;
  inventories2?: number | null;
  suppliers1?: number | null;
  suppliers2?: number | null;

  // ── Cifras del año ANTERIOR para ratios de variación/crecimiento ──
  // (los 11 indicadores del núcleo no las usan; sí los ratios de presentación).
  totalAssets2?: number | null;
  totalLiabilities2?: number | null;
  equity2?: number | null;
  ordinaryActivityRevenue2?: number | null;
}

/**
 * Ratios financieros estándar (de presentación). NO alimentan la viabilidad:
 * son para que el analista lea la salud financiera en el step2. Se calculan
 * igual para PDF y DataCrédito → columnas comparables. Se archivan en el JSONB
 * FinancialAnalysis.ratios. null cuando la base del ratio es 0/ausente (no se
 * fuerza a 0 para no inventar un valor: null = "no calculable").
 */
export interface FinancialRatios {
  workingCapital: number | null; // Capital de trabajo = ActCte − PasCte
  assetsVariation: number | null; // Variación Activos (%) vs año anterior
  liabilitiesVariation: number | null; // Variación Pasivo (%)
  equityVariation: number | null; // Variación Patrimonio (%)
  salesGrowth: number | null; // Crecimiento ventas (%)
  financialDebtToEbit: number | null; // Deuda Financiera / EBIT
  financialDebtToRevenue: number | null; // Deuda Financiera / Ingresos
  financialDebtToEquity: number | null; // Deuda financiera / Patrimonio
  liabilitiesToRevenue: number | null; // Pasivo / Ingresos
  grossMargin: number | null; // Margen Bruto (%)
  ebitMargin: number | null; // Margen EBIT (%)
  netMargin: number | null; // Margen Neto (%)
  operationalMargin: number | null; // Margen Operacional (%)
  leverage: number | null; // Apalancamiento = Pasivo / Patrimonio (convención de mercado)
  acidTest: number | null; // Prueba ácida
  currentRatio: number | null; // Razón Corriente
  roa: number | null; // ROA (%)
  roe: number | null; // ROE (%)
}

/**
 * Indicadores derivados de un estado financiero. Dependen SOLO de las cifras
 * crudas + el período del estado de resultados. Se guardan en FinancialStatement.
 */
export interface FinancialIndicators {
  stabilityFactor: number;
  ebitda: number;
  adjustedEbitda: number;
  currentDebtService: number;
  annualPaymentCapacity: number;
  monthlyPaymentCapacity: number;
  accountsReceivableTurnover: number;
  inventoryTurnover: number;
  suppliersTurnover: number;
  paymentTimeSuppliers: number;
  accountsPayableTurnover: number;
  /** Ratios de presentación (no alimentan la viabilidad). Se archivan aparte. */
  ratios: FinancialRatios;
}

/**
 * Calcula los indicadores financieros derivados de las cifras crudas de un
 * estado financiero. Función pura extraída de getCreditStudyPerform: preserva
 * exactamente el algoritmo (Z-Score de Altman → factor de estabilidad, EBITDA,
 * capacidad de pago, rotaciones). El período (mensual/anual) rige la
 * anualización de la capacidad de pago mensual.
 *
 * @param figures cifras crudas del estado financiero
 * @param periodLabel label del Parameter income_statement (p.ej. '12' = anual)
 */
export function computeFinancialIndicators(
  figures: FinancialStatementRawFigures,
  periodLabel: string,
): FinancialIndicators {
  const periodMonths = getMonthsFromPeriod(periodLabel);

  // ── Z-Score de Altman → factor de estabilidad ──
  const totalAssets = figures.totalAssets ?? 1;
  const x1 =
    ((figures.totalCurrentAssets ?? 0) -
      (figures.totalCurrentLiabilities ?? 0)) /
    totalAssets;
  const x2 = (figures.retainedEarnings ?? 0) / totalAssets;
  // x3 = utilidad operacional / activo total
  // Utilidad operacional = grossProfit - administrativeExpenses - sellingExpenses
  const x3 =
    ((figures.grossProfit ?? 0) -
      (figures.administrativeExpenses ?? 0) -
      (figures.sellingExpenses ?? 0)) /
    totalAssets;
  const x4 = (figures.equity ?? 0) / (figures.totalLiabilities ?? 1);
  const x5 = (figures.ordinaryActivityRevenue ?? 0) / totalAssets;

  const zScore = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + x5;

  const stabilityFactor = zScore > 3 ? 1 : zScore > 1.8 ? 0.66 : 0.33;

  // ── EBITDA y capacidad de pago ──
  const ebitda =
    (figures.ordinaryActivityRevenue ?? 0) -
    (figures.costOfSales ?? 0) -
    (figures.administrativeExpenses ?? 0) -
    (figures.sellingExpenses ?? 0) +
    (figures.depreciation ?? 0) +
    (figures.amortization ?? 0);

  const adjustedEbitda = ebitda * stabilityFactor;
  const currentDebtService =
    (figures.shortTermFinancialLiabilities ?? 0) +
    (figures.financialExpenses ?? 0);
  const annualPaymentCapacity = adjustedEbitda - currentDebtService;
  const monthlyPaymentCapacity = Math.round(
    annualPaymentCapacity / periodMonths,
  );

  // ── Rotaciones ──
  const accountsReceivableTurnover = Math.round(
    (((figures.accountsReceivable1 ?? 0) + (figures.accountsReceivable2 ?? 0)) /
      2 /
      (figures.ordinaryActivityRevenue ?? 1)) *
      365,
  );

  const inventoryTurnover = Math.round(
    (((figures.inventories1 ?? 0) + (figures.inventories2 ?? 0)) /
      2 /
      (figures.costOfSales ?? 1)) *
      365,
  );

  const accountsPayableTurnover1 =
    ((figures.suppliers1 ?? 0) + (figures.suppliers2 ?? 0)) / 2;
  const accountsPayableTurnover2 =
    (figures.costOfSales ?? 0) +
    (figures.inventories2 ?? 0) +
    (figures.administrativeExpenses ?? 0) +
    (figures.sellingExpenses ?? 0) -
    (figures.inventories1 ?? 0);

  const accountsPayableTurnover =
    accountsPayableTurnover1 / accountsPayableTurnover2;

  const paymentTimeSuppliers = Math.round(accountsPayableTurnover * 365);
  const suppliersTurnover = -paymentTimeSuppliers;

  // ── Ratios de presentación (estándar) ──────────────────
  const ratios = computeRatios(figures, ebitda);

  return {
    stabilityFactor,
    ebitda,
    adjustedEbitda,
    currentDebtService,
    annualPaymentCapacity,
    monthlyPaymentCapacity,
    accountsReceivableTurnover,
    inventoryTurnover,
    suppliersTurnover,
    paymentTimeSuppliers,
    accountsPayableTurnover,
    ratios,
  };
}

/** Divide devolviendo null si el denominador es 0/ausente (evita Infinity/NaN). */
function safeDiv(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  const n = numerator ?? 0;
  const d = denominator ?? 0;
  if (d === 0) return null;
  return n / d;
}

/** Redondea a 1 decimal, propagando null. */
function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/** Redondea a 2 decimales, propagando null. */
function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

/**
 * Ratios financieros estándar a partir de las cifras crudas del par de años.
 * "Deuda financiera" = obligaciones financieras corto + largo plazo. La utilidad
 * operacional (EBIT) = utilidad bruta − gastos admin − gastos de venta.
 */
function computeRatios(
  figures: FinancialStatementRawFigures,
  ebitda: number,
): FinancialRatios {
  const revenue = figures.ordinaryActivityRevenue ?? 0;
  const grossProfit = figures.grossProfit ?? 0;
  const admin = figures.administrativeExpenses ?? 0;
  const selling = figures.sellingExpenses ?? 0;
  const operatingIncome = grossProfit - admin - selling; // EBIT
  const netIncome = figures.netIncome ?? 0;
  const totalAssets = figures.totalAssets ?? 0;
  const totalLiabilities = figures.totalLiabilities ?? 0;
  const equity = figures.equity ?? 0;
  const currentAssets = figures.totalCurrentAssets ?? 0;
  const currentLiabilities = figures.totalCurrentLiabilities ?? 0;
  const inventories = figures.inventories1 ?? 0;
  const financialDebt =
    (figures.shortTermFinancialLiabilities ?? 0) +
    (figures.longTermFinancialLiabilities ?? 0);

  // Variaciones (%) vs año anterior. null si no hay base del año anterior.
  const variation = (
    current: number,
    prior: number | null | undefined,
  ): number | null => {
    if (prior === null || prior === undefined || prior === 0) return null;
    return round1(((current - prior) / Math.abs(prior)) * 100);
  };

  return {
    workingCapital: currentAssets - currentLiabilities,
    assetsVariation: variation(totalAssets, figures.totalAssets2),
    liabilitiesVariation: variation(
      totalLiabilities,
      figures.totalLiabilities2,
    ),
    equityVariation: variation(equity, figures.equity2),
    salesGrowth: variation(revenue, figures.ordinaryActivityRevenue2),
    financialDebtToEbit: round2(safeDiv(financialDebt, operatingIncome)),
    financialDebtToRevenue: round2(safeDiv(financialDebt, revenue)),
    financialDebtToEquity: round2(safeDiv(financialDebt, equity)),
    liabilitiesToRevenue: round2(safeDiv(totalLiabilities, revenue)),
    grossMargin: round1(mulPct(safeDiv(grossProfit, revenue))),
    ebitMargin: round1(mulPct(safeDiv(ebitda, revenue))),
    netMargin: round1(mulPct(safeDiv(netIncome, revenue))),
    operationalMargin: round1(mulPct(safeDiv(operatingIncome, revenue))),
    leverage: round2(safeDiv(totalLiabilities, equity)),
    acidTest: round2(safeDiv(currentAssets - inventories, currentLiabilities)),
    currentRatio: round2(safeDiv(currentAssets, currentLiabilities)),
    roa: round1(mulPct(safeDiv(netIncome, totalAssets))),
    roe: round1(mulPct(safeDiv(netIncome, equity))),
  };
}

/** Multiplica por 100 para expresar como porcentaje, propagando null. */
function mulPct(value: number | null): number | null {
  return value === null ? null : value * 100;
}
