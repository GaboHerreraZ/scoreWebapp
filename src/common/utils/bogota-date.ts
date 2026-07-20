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
