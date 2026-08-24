/**
 * Fechas SIN hora ni huso (columnas `@db.Date`): fecha de corte del balance,
 * fecha de un pagaré, etc. Son fechas de CALENDARIO — "31 de diciembre de 2025"
 * no ocurre a ninguna hora y no se traduce entre husos.
 *
 * Prisma las materializa como un Date en medianoche UTC. Si ese Date se
 * serializa tal cual ("2025-12-31T00:00:00.000Z") y el cliente lo formatea en
 * su huso local, Colombia (UTC−5) lo retrocede al DIA ANTERIOR: el corte al 31
 * de diciembre se muestra como 30 de diciembre. Por eso estas fechas salen de
 * la API como 'YYYY-MM-DD', que el DatePipe de Angular interpreta como fecha
 * local y no desplaza.
 *
 * OJO: no usar bogota-date.ts aquí. Esos helpers convierten instantes reales
 * (un pago, un evento) al huso de Colombia; aplicarlos a una fecha de
 * calendario le restaría cinco horas y causaría justo el corrimiento que este
 * módulo evita.
 */

/** Fecha de calendario como 'YYYY-MM-DD'. Lee los componentes en UTC. */
export function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parsea una fecha de calendario a medianoche UTC, que es como Prisma espera
 * un `@db.Date`.
 *
 * No se usa `new Date(str)` directo: con 'YYYY-MM-DD' acierta (lo trata como
 * UTC), pero con las variantes que puede devolver un modelo —'2025-12-31
 * 00:00:00' o '2025-12-31T00:00:00' sin zona— lo interpreta como medianoche
 * LOCAL, y en un servidor al oeste de UTC eso cae en el día anterior al
 * convertirlo. Aquí se toman los tres números y se arma la fecha en UTC.
 *
 * Devuelve undefined si el valor no trae un YYYY-MM-DD reconocible.
 */
export function parseDateOnly(
  value: string | null | undefined,
): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Descarta fechas imposibles que el rollover de Date convertiría en otra
  // (p. ej. '2025-02-31' -> 3 de marzo).
  return date.getUTCDate() === Number(day) &&
    date.getUTCMonth() === Number(month) - 1
    ? date
    : undefined;
}
