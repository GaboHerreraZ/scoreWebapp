// ─── Helpers numéricos y de formato compartidos ────────────────────────────
// Usados por los engines de scoring (EEFF y capacidad de pago). OJO: hay
// homónimos con OTRA semántica que no pertenecen aquí (el `money` de Aliaddo
// devuelve número con redondeo DIAN; los `round*` de financial-indicators son
// null-tolerantes).

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Ratio 0–1 → "85%". */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Pesos colombianos para textos de alertas: "$1.234.567". */
export function money(v: number): string {
  return `$${Math.round(v).toLocaleString('es-CO')}`;
}

/** minúsculas, sin tildes ni espacios extra (comparaciones de texto libre). */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
