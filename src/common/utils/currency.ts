/**
 * Formatea un monto como pesos colombianos (COP), sin decimales.
 * Ej: 1500000 → "$ 1.500.000".
 */
export function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);
}
