/** Meses del año en español, en minúsculas (para fechas en documentos legales). */
export const MESES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * Mes 'YYYY-MM' de una fecha visto desde Colombia. Necesario para agrupar por
 * mes sin que el huso del servidor mueva las ventas de fin de mes: un pago del
 * 31 a las 8pm en Bogotá es de ESE mes, aunque en UTC ya sea el día 1.
 */
export function bogotaAccrualMonth(date: Date): string {
  // en-CA da ISO (YYYY-MM-DD); nos quedamos con año-mes.
  return date
    .toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
    .slice(0, 7);
}

/** Día/mes/año de una fecha vistos desde Colombia (el server puede estar en UTC). */
export function bogotaDateParts(date: Date): {
  day: number;
  monthName: string;
  year: number;
} {
  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    day: get('day'),
    monthName: MESES_ES[get('month') - 1] ?? '',
    year: get('year'),
  };
}
