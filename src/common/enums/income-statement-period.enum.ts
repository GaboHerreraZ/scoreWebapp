export enum IncomeStatementPeriod {
  ANUAL = 12,
  TRIMESTRAL = 3,
  SEMESTRAL = 6,
  MENSUAL = 1,
}

/**
 * Maps parameter names to their corresponding month values
 */
export const INCOME_STATEMENT_PERIOD_MAP: Record<string, number> = {
  Anual: IncomeStatementPeriod.ANUAL,
  Trimestral: IncomeStatementPeriod.TRIMESTRAL,
  Semestral: IncomeStatementPeriod.SEMESTRAL,
  Mensual: IncomeStatementPeriod.MENSUAL,
};

/**
 * Gets the number of months from a period parameter name
 * @param periodName - The name of the period (e.g., "Anual", "Trimestral")
 * @returns The number of months, defaults to 12 if not found
 */
export function getMonthsFromPeriod(periodName: string): number {
  return INCOME_STATEMENT_PERIOD_MAP[periodName] ?? IncomeStatementPeriod.ANUAL;
}
