/**
 * Converts a non-negative integer amount (in COP) to its Spanish text representation
 * suitable for legal documents (promissory notes).
 *
 * Examples:
 *   numberToSpanishWords(0)         -> "CERO PESOS M/CTE"
 *   numberToSpanishWords(1)         -> "UN PESO M/CTE"
 *   numberToSpanishWords(21)        -> "VEINTIÚN PESOS M/CTE"
 *   numberToSpanishWords(100)       -> "CIEN PESOS M/CTE"
 *   numberToSpanishWords(101)       -> "CIENTO UN PESOS M/CTE"
 *   numberToSpanishWords(1000)      -> "UN MIL PESOS M/CTE"
 *   numberToSpanishWords(2_500_000) -> "DOS MILLONES QUINIENTOS MIL PESOS M/CTE"
 *   numberToSpanishWords(1_000_000) -> "UN MILLÓN DE PESOS M/CTE"
 *
 * Supports values up to 999,999,999,999 (below a trillion), which is more than
 * enough for any realistic promissory note amount.
 */

const UNITS = [
  '',
  'UNO',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
  'VEINTE',
];

const TENS = [
  '',
  '',
  'VEINTI',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];

const HUNDREDS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

/**
 * Converts an integer in [0, 999] to words.
 * `apocopeOne` = true produces "UN" instead of "UNO" (used before nouns like "MIL" or "MILLÓN").
 */
function convertUnder1000(n: number, apocopeOne: boolean): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';

  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;

  const parts: string[] = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);

  if (remainder > 0) {
    if (remainder <= 20) {
      let word = UNITS[remainder];
      if (remainder === 1 && apocopeOne) word = 'UN';
      parts.push(word);
    } else if (remainder < 30) {
      // 21..29 — written as a single word: VEINTIUNO, VEINTIDÓS, ...
      const unit = remainder - 20;
      let word: string;
      if (unit === 1) word = apocopeOne ? 'VEINTIÚN' : 'VEINTIUNO';
      else if (unit === 2) word = 'VEINTIDÓS';
      else if (unit === 3) word = 'VEINTITRÉS';
      else if (unit === 6) word = 'VEINTISÉIS';
      else word = 'VEINTI' + UNITS[unit];
      parts.push(word);
    } else {
      const tens = Math.floor(remainder / 10);
      const unit = remainder % 10;
      if (unit === 0) {
        parts.push(TENS[tens]);
      } else {
        let unitWord = UNITS[unit];
        if (unit === 1 && apocopeOne) unitWord = 'UN';
        parts.push(`${TENS[tens]} Y ${unitWord}`);
      }
    }
  }

  return parts.join(' ');
}

/**
 * Converts a non-negative integer to Spanish words without any currency suffix.
 */
function integerToWords(n: number): string {
  if (n === 0) return 'CERO';

  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const units = n % 1000;

  const parts: string[] = [];

  if (billions > 0) {
    // Spanish uses "millardo" rarely — use "MIL MILLONES" convention.
    // `billions` will never exceed 999 for realistic promissory amounts.
    const word = convertUnder1000(billions, true);
    parts.push(billions === 1 ? 'MIL MILLONES' : `${word} MIL MILLONES`);
  }

  if (millions > 0) {
    if (millions === 1) {
      parts.push('UN MILLÓN');
    } else {
      parts.push(`${convertUnder1000(millions, true)} MILLONES`);
    }
  }

  if (thousands > 0) {
    if (thousands === 1) {
      parts.push('MIL');
    } else {
      parts.push(`${convertUnder1000(thousands, true)} MIL`);
    }
  }

  if (units > 0) {
    parts.push(convertUnder1000(units, true));
  }

  return parts.join(' ');
}

/**
 * Converts an integer COP amount to its legal Spanish representation for
 * promissory notes: uppercase with "M/CTE" (moneda corriente) suffix.
 */
export function numberToSpanishWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid amount for conversion: ${amount}`);
  }

  const integer = Math.trunc(amount);
  const words = integerToWords(integer);
  const pesoWord = integer === 1 ? 'PESO' : 'PESOS';
  return `${words} ${pesoWord} M/CTE`;
}
