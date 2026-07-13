// ─── Vigencia de una consulta guardada (¿reusar BBDD o re-consultar?) ───────
// DataCrédito actualiza su información en los primeros 10 días de cada mes. Por
// eso, una consulta guardada sigue siendo "fresca" (reusable) hasta el día 10
// del mes SIGUIENTE al que se hizo. A partir del día 11 de ese mes siguiente, ya
// hay data nueva del mes → toca re-consultar.
//
// Ejemplo (consultaAt = 1-jul):
//   límite = 10-ago (fin del día). 22-jul, 30-jul, 9-ago → reusar BBDD.
//   11-ago en adelante → re-consultar. (El rollover dic→ene se maneja solo.)

const REFRESH_CUTOFF_DAY = 10;

/**
 * Fin del día 10 del mes siguiente a `consultaAt`. Hasta esa fecha (inclusive)
 * la consulta guardada se reusa; después, se re-consulta. Maneja el cambio de
 * año (dic → ene) porque Date normaliza el mes 12 a enero del año siguiente.
 */
export function getConsultationExpiry(consultaAt: Date): Date {
  const year = consultaAt.getFullYear();
  const month = consultaAt.getMonth(); // 0-indexed
  // Día 10 del mes siguiente, 23:59:59.999. `month + 1` = mes siguiente;
  // si month=11 (dic) → new Date normaliza a enero del año+1.
  return new Date(year, month + 1, REFRESH_CUTOFF_DAY, 23, 59, 59, 999);
}

/**
 * ¿La consulta guardada sigue vigente en `now`? true → reusar BBDD; false →
 * re-consultar la central. `now` se inyecta para poder testear (en runtime
 * pasar new Date()).
 */
export function isConsultationFresh(consultaAt: Date, now: Date): boolean {
  return now.getTime() <= getConsultationExpiry(consultaAt).getTime();
}
