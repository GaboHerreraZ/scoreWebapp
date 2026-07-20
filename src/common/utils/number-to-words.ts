/**
 * Convierte un entero a su escritura en español (es-CO), para montos en
 * documentos legales. Ej: 20500000 → "veinte millones quinientos mil".
 * La palabra "pesos" NO se incluye: la pone la plantilla del documento.
 * Soporta hasta billones (10^12 exclusive). Los decimales se redondean.
 */

const UNIDADES = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

const DECENAS = [
  '',
  '',
  '',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];

const CENTENAS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

/** 0-999 en palabras. `apocope` usa "un/veintiún/…y un" (antes de mil/millón). */
function threeDigits(n: number, apocope: boolean): string {
  if (n === 100) return 'cien';

  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(CENTENAS[hundreds]);

  if (rest > 0) {
    if (rest < 30) {
      let word = UNIDADES[rest];
      if (apocope) {
        if (rest === 1) word = 'un';
        if (rest === 21) word = 'veintiún';
      }
      parts.push(word);
    } else {
      const tens = DECENAS[Math.floor(rest / 10)];
      const units = rest % 10;
      if (units === 0) {
        parts.push(tens);
      } else {
        const unitWord = apocope && units === 1 ? 'un' : UNIDADES[units];
        parts.push(`${tens} y ${unitWord}`);
      }
    }
  }
  return parts.join(' ');
}

export function numberToSpanishWords(value: number): string {
  const n = Math.round(Math.abs(value));
  if (n === 0) return 'cero';
  if (n >= 1_000_000_000_000) {
    throw new RangeError(
      `numberToSpanishWords soporta hasta 999.999.999.999 (recibió ${value})`,
    );
  }

  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const units = n % 1_000;
  const parts: string[] = [];

  if (millions > 0) {
    if (millions === 1) {
      parts.push('un millón');
    } else {
      // El grupo de millones puede a su vez tener miles: 1.234 millones.
      const millionThousands = Math.floor(millions / 1_000);
      const millionUnits = millions % 1_000;
      const sub: string[] = [];
      if (millionThousands > 0) {
        sub.push(
          millionThousands === 1
            ? 'mil'
            : `${threeDigits(millionThousands, true)} mil`,
        );
      }
      if (millionUnits > 0) sub.push(threeDigits(millionUnits, true));
      parts.push(`${sub.join(' ')} millones`);
    }
  }

  if (thousands > 0) {
    parts.push(thousands === 1 ? 'mil' : `${threeDigits(thousands, true)} mil`);
  }

  if (units > 0) parts.push(threeDigits(units, false));

  return parts.join(' ');
}
