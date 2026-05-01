const DEFAULT_MONTHS = 12;

export function getMonthsFromPeriod(periodName: string): number {
  const numeric = Number(periodName);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
    return numeric;
  }
  return DEFAULT_MONTHS;
}
