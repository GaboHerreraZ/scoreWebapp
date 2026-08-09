const DEFAULT_MONTHS = 12;

export function getMonthsFromPeriod(periodName: string): number {
  const numeric = Number(periodName);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
    return numeric;
  }
  return DEFAULT_MONTHS;
}

/**
 * Resuelve cuántos meses abarca el estado de resultados que se va a analizar.
 *
 * Manda lo que dice el DOCUMENTO (`detected`, leído por la IA del encabezado del
 * ERI) por encima de lo que eligió el usuario en el formulario: unos EEFF con
 * corte a junio son de 6 meses aunque alguien haya marcado "anual" en el combo.
 * Si la IA no lo pudo determinar se cae al Parameter income_statement, y en
 * último caso a 12.
 *
 * @param detected meses leídos del documento (1..12), o undefined
 * @param fallbackLabel label del Parameter income_statement (p.ej. '12')
 */
export function resolvePeriodMonths(
  detected: number | null | undefined,
  fallbackLabel: string,
): number {
  if (typeof detected === 'number' && Number.isInteger(detected)) {
    if (detected >= 1 && detected <= 12) return detected;
  }
  return getMonthsFromPeriod(fallbackLabel);
}

/**
 * Días que abarca un período de `months` meses, con el año comercial de 360
 * días (30 días por mes) que usan las rotaciones del modelo financiero.
 *
 * Es el factor de las rotaciones: días de cartera, de inventario y de pago a
 * proveedores. Antes estaba fijo en 365, lo que sobrestimaba los días en todo
 * estado financiero intermedio — unos EEFF a junio reportaban el doble de días
 * de cartera de los reales, porque comparaban un saldo de medio año contra los
 * ingresos de medio año y lo escalaban a un año entero.
 */
export function getPeriodDays(months: number): number {
  return 30 * months;
}
