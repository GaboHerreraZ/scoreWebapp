/**
 * Dígito de verificación del NIT (algoritmo de la DIAN).
 *
 * No se almacena: se calcula. Guardarlo sería duplicar un dato derivado y abrir
 * la puerta a que quede desincronizado del número.
 *
 * El algoritmo: se multiplica cada dígito (de derecha a izquierda) por un primo
 * de la tabla oficial, se suman los productos y se toma el residuo entre 11.
 * Residuo 0 o 1 → el DV es el residuo; en cualquier otro caso, 11 − residuo.
 */

// Primos de la tabla de la DIAN, en orden desde el dígito MENOS significativo.
const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/**
 * @param identificationNumber NIT sin DV. Se ignoran puntos, guiones y espacios.
 * @returns el DV como string ('0'..'9'), o '' si el número no es utilizable.
 */
export function calculateVerificationDigit(
  identificationNumber: string | null | undefined,
): string {
  if (!identificationNumber) return '';

  const digits = identificationNumber.replace(/\D/g, '');
  if (!digits || digits.length > WEIGHTS.length) return '';

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // Se recorre de derecha a izquierda: el último dígito lleva el primer primo.
    const digit = Number(digits[digits.length - 1 - i]);
    sum += digit * WEIGHTS[i];
  }

  const remainder = sum % 11;
  return String(remainder < 2 ? remainder : 11 - remainder);
}
