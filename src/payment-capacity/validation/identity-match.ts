// ─── Match difuso de identidad (validación V5) ─────────────────────────────
// Los documentos traen el nombre del titular en formas distintas: el extracto
// lo trunca al ancho del campo ("GABRIEL GIOVANY HERRERA ZAR"), la nómina usa
// la forma corta ("Gabriel Herrera") y el Customer viene de la central
// ("HERRERA ZARATE GABRIEL GIOVANY"). NUNCA comparar por igualdad exacta.

/** Normaliza un nombre: mayúsculas, sin tildes, sin mojibake, solo letras. */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tildes
    .toUpperCase()
    .replace(/[^A-ZÑ ]+/g, ' ') // mojibake (¥, dígitos, puntuación) → espacio
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿Los dos nombres corresponden plausiblemente a la misma persona?
 *
 * Regla: se tokenizan ambos; cada token del nombre MÁS CORTO debe hacer match
 * por PREFIJO con algún token del más largo (prefijo cubre el truncamiento:
 * "ZAR" matchea "ZARATE"; y la forma corta: "Gabriel Herrera" ⊂ "Herrera
 * Zarate Gabriel Giovany"). El orden no importa (la central invierte
 * apellidos/nombres). Tokens de 1 letra (iniciales) se ignoran.
 */
export function namesMatch(a: string, b: string): boolean {
  const tokensA = normalizeName(a)
    .split(' ')
    .filter((t) => t.length > 1);
  const tokensB = normalizeName(b)
    .split(' ')
    .filter((t) => t.length > 1);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  const available = [...longer];
  let matched = 0;
  for (const token of shorter) {
    const idx = available.findIndex(
      (candidate) => candidate.startsWith(token) || token.startsWith(candidate),
    );
    if (idx >= 0) {
      matched += 1;
      available.splice(idx, 1); // un token del largo no matchea dos veces
    }
  }
  // Todos los tokens del corto deben matchear y al menos 2 (un solo apellido
  // compartido no identifica a nadie).
  return matched === shorter.length && matched >= 2;
}

/** Normaliza un número de identificación: solo dígitos (quita puntos, guiones
 *  y sufijos tipo "109621657-9" → compara también sin el posible sufijo). */
export function idNumbersMatch(a: string, b: string): boolean {
  const clean = (v: string) => v.replace(/\D+/g, '');
  const ca = clean(a);
  const cb = clean(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  // El desprendible puede traer un dígito extra pegado (formato del software).
  const [longer, shorter] = ca.length >= cb.length ? [ca, cb] : [cb, ca];
  return longer.length - shorter.length === 1 && longer.startsWith(shorter);
}
