import { BadRequestException } from '@nestjs/common';
import type { FinancialStatementRawFigures } from './financial-indicators.js';

/**
 * Normalización de los períodos que devuelve la extracción IA del PDF. Lógica
 * PURA (sin Prisma ni persistencia) para que la comparta el flujo real
 * (FinancialStatementsService, que la guarda) y la prueba del portal admin
 * (que solo la muestra): los dos leen exactamente las mismas cifras.
 */

/** Cifras crudas de UN año que devuelve la IA (un objeto por período). */
export interface ExtractedPeriod {
  fiscalYear?: number | null;
  balanceSheetDate?: string | null;
  statementMonths?: number | null;

  cashAndEquivalents?: number | null;
  accountsReceivable?: number | null;
  inventories?: number | null;
  totalCurrentAssets?: number | null;
  fixedAssetsProperty?: number | null;
  totalNonCurrentAssets?: number | null;
  totalAssets?: number | null;
  shortTermFinancialLiabilities?: number | null;
  suppliers?: number | null;
  totalCurrentLiabilities?: number | null;
  longTermFinancialLiabilities?: number | null;
  totalNonCurrentLiabilities?: number | null;
  totalLiabilities?: number | null;
  retainedEarnings?: number | null;
  equity?: number | null;

  ordinaryActivityRevenue?: number | null;
  costOfSales?: number | null;
  grossProfit?: number | null;
  administrativeExpenses?: number | null;
  sellingExpenses?: number | null;
  depreciation?: number | null;
  amortization?: number | null;
  financialExpenses?: number | null;
  taxes?: number | null;
  netIncome?: number | null;
}

/** La IA devuelve un arreglo de períodos (uno por año del documento). */
export interface ExtractedFinancialData {
  periods?: ExtractedPeriod[];
}

/** Campos monetarios que se copian tal cual de la IA al período. */
export const PERIOD_FIGURE_FIELDS = [
  'cashAndEquivalents',
  'accountsReceivable',
  'inventories',
  'totalCurrentAssets',
  'fixedAssetsProperty',
  'totalNonCurrentAssets',
  'totalAssets',
  'shortTermFinancialLiabilities',
  'suppliers',
  'totalCurrentLiabilities',
  'longTermFinancialLiabilities',
  'totalNonCurrentLiabilities',
  'totalLiabilities',
  'retainedEarnings',
  'equity',
  'ordinaryActivityRevenue',
  'costOfSales',
  'grossProfit',
  'administrativeExpenses',
  'sellingExpenses',
  'depreciation',
  'amortization',
  'financialExpenses',
  'taxes',
  'netIncome',
] as const;

export type PeriodFigureField = (typeof PERIOD_FIGURE_FIELDS)[number];

/**
 * Campos de costo/gasto que son MAGNITUDES: el estado de resultados los presenta
 * entre paréntesis (o con signo menos) porque SE RESTAN, no porque sean
 * negativos. Las fórmulas de financial-indicators los restan por sí mismas, así
 * que un signo negativo las convierte en sumas (EBITDA y capacidad de pago
 * inflados ~13× en un caso real). Se normalizan a valor absoluto — cinturón de
 * la regla de SIGNOS del prompt de extracción. Los conceptos que sí pueden ser
 * negativos (netIncome, retainedEarnings, equity, grossProfit) NO están aquí.
 */
export const EXPENSE_MAGNITUDE_FIELDS: ReadonlySet<string> = new Set([
  'costOfSales',
  'administrativeExpenses',
  'sellingExpenses',
  'depreciation',
  'amortization',
  'financialExpenses',
  'taxes',
]);

/** Cifras crudas de un período, ya normalizadas (sin metadatos de persistencia). */
export type PeriodFigures = Partial<
  Record<PeriodFigureField, number | null | undefined>
>;

/** Un período normalizado: año fiscal resuelto + fecha de balance + cifras. */
export interface NormalizedPeriod extends PeriodFigures {
  fiscalYear: number;
  balanceSheetDate?: Date;
  statementMonths?: number;
}

/**
 * Normaliza un período que devolvió la IA: resuelve el año fiscal (de la IA, del
 * balanceSheetDate o del fallback) y pasa a valor absoluto los gastos que son
 * magnitudes.
 *
 * @param fallbackFiscalYear año que aporta el usuario cuando el PDF no lo trae
 */
export function normalizeExtractedPeriod(
  p: ExtractedPeriod,
  fallbackFiscalYear?: number | null,
): NormalizedPeriod {
  const balanceSheetDate =
    typeof p.balanceSheetDate === 'string' && p.balanceSheetDate
      ? new Date(p.balanceSheetDate)
      : undefined;

  const fiscalYear =
    (typeof p.fiscalYear === 'number' ? p.fiscalYear : null) ??
    balanceSheetDate?.getUTCFullYear() ??
    fallbackFiscalYear ??
    null;
  if (fiscalYear === null) {
    throw new BadRequestException(
      'No se pudo determinar el año fiscal de un período: la IA no devolvió fiscalYear ni fecha de balance. Envía fiscalYear.',
    );
  }

  const figures: PeriodFigures = {};
  for (const field of PERIOD_FIGURE_FIELDS) {
    const value = p[field];
    figures[field] =
      typeof value === 'number' && EXPENSE_MAGNITUDE_FIELDS.has(field)
        ? Math.abs(value)
        : value;
  }

  return {
    fiscalYear,
    balanceSheetDate,
    statementMonths: normalizeStatementMonths(p.statementMonths),
    ...figures,
  };
}

/**
 * Valida los meses del estado de resultados que devolvió la IA. Solo se acepta
 * un entero de 1 a 12; cualquier otra cosa (null, 0, 18, decimales, texto) se
 * descarta devolviendo undefined para que decida el fallback del consumidor.
 *
 * No se corrige ni se aproxima: un valor fuera de rango significa que el modelo
 * no entendió el encabezado, y suponer un número sería peor que caer al
 * fallback explícito.
 */
export function normalizeStatementMonths(
  value: number | null | undefined,
): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= 12 ? value : undefined;
}

/**
 * Elige el período ANTERIOR contra el que se comparan las cifras del corriente:
 * el primero de la lista (ordenada por año DESC) cuyo año sea MENOR.
 *
 * No basta con tomar periods[1]. La extracción puede devolver DOS columnas del
 * MISMO año —pasa con documentos que traen un comparativo intermedio, o cuando
 * el modelo lee dos veces el mismo cierre—, y entonces periods[1] no es el año
 * anterior: las variaciones (activos, patrimonio, ventas) y el delta de
 * inventario se calcularían contra el mismo año, y el año anterior de verdad
 * quedaría ignorado más abajo en la lista.
 */
export function selectPriorPeriod<T extends { fiscalYear: number }>(
  periods: readonly T[],
  current: T,
): T | undefined {
  return periods.find((p) => p.fiscalYear < current.fiscalYear);
}

/**
 * Arma las cifras que consume computeFinancialIndicators a partir del par de
 * períodos más recientes. El corriente aporta todo el EERR y los saldos de
 * cierre; del anterior solo se toman los saldos de apertura.
 *
 * Numeración de los pares (igual que el modelo financiero original): *_1 es el
 * año MÁS ANTIGUO (apertura) y *_2 el MÁS RECIENTE (cierre). Con unos EEFF
 * 2024–2025: suppliers1 = 2024, suppliers2 = 2025. Las cifras del año anterior
 * que usan los ratios de variación van con sufijo "Prior", no con "2", para que
 * no se confunda con el 2 = más reciente de los pares.
 */
export function toIndicatorFigures(
  current: PeriodFigures,
  prior?: PeriodFigures,
): FinancialStatementRawFigures {
  // Sin período anterior no hay saldo de APERTURA. Se replica el de cierre para
  // que el promedio del par sea el propio saldo: con (0 + saldo) / 2 las
  // rotaciones salían a la MITAD de lo que corresponde, como si la empresa
  // hubiera arrancado el año en cero. Los campos *Prior se dejan vacíos aparte:
  // sin año anterior no hay variación que calcular y deben quedar en null.
  const opening = prior ?? current;

  return {
    totalCurrentAssets: current.totalCurrentAssets,
    totalCurrentLiabilities: current.totalCurrentLiabilities,
    totalAssets: current.totalAssets,
    retainedEarnings: current.retainedEarnings,
    grossProfit: current.grossProfit,
    administrativeExpenses: current.administrativeExpenses,
    sellingExpenses: current.sellingExpenses,
    equity: current.equity,
    totalLiabilities: current.totalLiabilities,
    ordinaryActivityRevenue: current.ordinaryActivityRevenue,
    costOfSales: current.costOfSales,
    depreciation: current.depreciation,
    amortization: current.amortization,
    shortTermFinancialLiabilities: current.shortTermFinancialLiabilities,
    longTermFinancialLiabilities: current.longTermFinancialLiabilities,
    financialExpenses: current.financialExpenses,
    netIncome: current.netIncome,
    // Pares para rotaciones: *_1 = apertura (año antiguo), *_2 = cierre (año
    // reciente). El delta de inventario de las compras depende de este orden.
    accountsReceivable1: opening.accountsReceivable,
    accountsReceivable2: current.accountsReceivable,
    inventories1: opening.inventories,
    inventories2: current.inventories,
    suppliers1: opening.suppliers,
    suppliers2: current.suppliers,
    // Totales del año anterior para ratios de variación/crecimiento.
    totalAssetsPrior: prior?.totalAssets,
    totalLiabilitiesPrior: prior?.totalLiabilities,
    equityPrior: prior?.equity,
    ordinaryActivityRevenuePrior: prior?.ordinaryActivityRevenue,
  };
}
