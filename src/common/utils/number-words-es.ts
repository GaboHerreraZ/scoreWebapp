// ─── Parser de montos en letras (español, COP) ─────────────────────────────
// Utilitario genérico. Devuelve null si no puede interpretar el texto, para
// que el llamador trate el caso como "no evaluable" y no como falso negativo.
// Uso actual: validación V9 (neto en letras vs neto en número del desprendible).

const UNITS: Record<string, number> = {
  CERO: 0,
  UN: 1,
  UNO: 1,
  UNA: 1,
  DOS: 2,
  TRES: 3,
  CUATRO: 4,
  CINCO: 5,
  SEIS: 6,
  SIETE: 7,
  OCHO: 8,
  NUEVE: 9,
  DIEZ: 10,
  ONCE: 11,
  DOCE: 12,
  TRECE: 13,
  CATORCE: 14,
  QUINCE: 15,
  DIECISEIS: 16,
  DIECISIETE: 17,
  DIECIOCHO: 18,
  DIECINUEVE: 19,
  VEINTE: 20,
  VEINTIUN: 21,
  VEINTIUNO: 21,
  VEINTIDOS: 22,
  VEINTITRES: 23,
  VEINTICUATRO: 24,
  VEINTICINCO: 25,
  VEINTISEIS: 26,
  VEINTISIETE: 27,
  VEINTIOCHO: 28,
  VEINTINUEVE: 29,
};

const TENS: Record<string, number> = {
  TREINTA: 30,
  CUARENTA: 40,
  CINCUENTA: 50,
  SESENTA: 60,
  SETENTA: 70,
  OCHENTA: 80,
  NOVENTA: 90,
};

const HUNDREDS: Record<string, number> = {
  CIEN: 100,
  CIENTO: 100,
  DOSCIENTOS: 200,
  TRESCIENTOS: 300,
  CUATROCIENTOS: 400,
  QUINIENTOS: 500,
  SEISCIENTOS: 600,
  SETECIENTOS: 700,
  OCHOCIENTOS: 800,
  NOVECIENTOS: 900,
};

/**
 * Convierte un monto en letras a número. Soporta el rango real de una nómina
 * (hasta miles de millones). Ignora la moneda y las coletillas legales.
 * Ej.: "SIETE MILLONES SETECIENTOS DOS MIL DOSCIENTOS NOVENTA Y NUEVE PESOS
 * MONEDA LEGAL" → 7702299.
 */
export function parseSpanishAmountWords(raw: string): number | null {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // Coletillas que no aportan al número.
    .replace(/PESOS?|MONEDA LEGAL|M\/?CTE|MCTE|COLOMBIANOS?|EXACTOS?/g, ' ')
    .replace(/CON\s+\d+\s*\/\s*100/g, ' ') // "CON 50/100" (centavos)
    .replace(/[^A-ZÑ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const words = cleaned.split(' ').filter((w) => w !== 'Y' && w !== 'DE');

  let total = 0; // millones ya cerrados
  let current = 0; // grupo en construcción (< 1.000.000)
  let matchedAny = false;

  for (const word of words) {
    if (word in HUNDREDS) {
      current += HUNDREDS[word];
      matchedAny = true;
    } else if (word in TENS) {
      current += TENS[word];
      matchedAny = true;
    } else if (word in UNITS) {
      current += UNITS[word];
      matchedAny = true;
    } else if (word === 'MIL') {
      // "MIL" solo = 1000; "DOSCIENTOS DOS MIL" = 202×1000.
      current = (current === 0 ? 1 : current) * 1000;
      matchedAny = true;
    } else if (word === 'MILLON' || word === 'MILLONES') {
      total += (current === 0 ? 1 : current) * 1_000_000;
      current = 0;
      matchedAny = true;
    } else {
      // Palabra desconocida: el texto trae algo que no es un número en letras.
      return null;
    }
  }

  if (!matchedAny) return null;
  return total + current;
}
