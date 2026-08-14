/**
 * Medio de pago DIAN de la factura.
 *
 * El código es de la DIAN (dominio), pero el dato de ENTRADA viene de la
 * pasarela: ePayco reporta una "franquicia" (`x_franchise`) por la que se pagó.
 * Traducir de una a otra vive aquí y no en el adaptador de facturación, porque
 * no tiene nada que ver con quién emite el documento.
 *
 * Si mañana cambia la pasarela, se cambia este mapa; si cambia el proveedor de
 * facturación, este archivo no se toca.
 */

/** Códigos DIAN usados. La tabla completa tiene 45. */
export const DIAN_PAYMENT_MEAN = {
  /** Cuando no se puede determinar cómo pagó. Es válido ante la DIAN. */
  undefined: '1',
  cash: '10',
  bankDeposit: '42',
  /** Débito en línea de una cuenta o depósito del comprador (PSE, billeteras). */
  bankDebitTransfer: '47',
  creditCard: '48',
  debitCard: '49',
} as const;

/**
 * Franquicia de ePayco → medio de pago DIAN.
 *
 * LÍMITE CONOCIDO — no distinguimos 48 de 49. `x_franchise` reporta la MARCA de
 * la tarjeta ('VS', 'MC'), no si es de crédito o débito: una Visa débito llega
 * igual que una Visa crédito. Revisado contra los eventos reales de ePayco,
 * donde `x_payment_method` resultó ser un duplicado exacto de `x_franchise`, así
 * que no hay de dónde sacar el dato. Se usa 48 para toda tarjeta; el medio de
 * pago es informativo en el documento y la DIAN no lo cruza contra nada.
 *
 * Las entradas marcadas ANTICIPADO no se han visto todavía en producción: son
 * el nombre más probable del valor. Si ePayco lo escribe distinto, no casa, cae
 * al fallback y el log lo delata con el valor exacto para corregirlo aquí.
 */
const FRANCHISE_TO_DIAN: Record<string, string> = {
  // Tarjetas (observadas: VS)
  VS: DIAN_PAYMENT_MEAN.creditCard, // Visa
  MC: DIAN_PAYMENT_MEAN.creditCard, // Mastercard
  AM: DIAN_PAYMENT_MEAN.creditCard, // American Express
  DC: DIAN_PAYMENT_MEAN.creditCard, // Diners Club
  DI: DIAN_PAYMENT_MEAN.creditCard, // Diners (variante)
  CR: DIAN_PAYMENT_MEAN.creditCard, // Credencial

  // Débito bancario en línea (observada: PSE)
  PSE: DIAN_PAYMENT_MEAN.bankDebitTransfer,

  // Billeteras. Son depósitos de bajo monto: pagar desde ellas es un débito de
  // una cuenta del comprador, igual que PSE. La DIAN no tiene código propio
  // para billetera. ANTICIPADO.
  NEQUI: DIAN_PAYMENT_MEAN.bankDebitTransfer,
  DAVIPLATA: DIAN_PAYMENT_MEAN.bankDebitTransfer,

  // Efectivo en corresponsal. ANTICIPADO.
  EFECTY: DIAN_PAYMENT_MEAN.cash,
  BALOTO: DIAN_PAYMENT_MEAN.cash,
  GANA: DIAN_PAYMENT_MEAN.cash,
  SURED: DIAN_PAYMENT_MEAN.cash,
  PUNTORED: DIAN_PAYMENT_MEAN.cash,
};

/** Nombre DIAN de cada código, para mostrarlo en el preview del panel. */
const DIAN_PAYMENT_MEAN_LABEL: Record<string, string> = {
  '1': 'Instrumento no definido',
  '10': 'Efectivo',
  '42': 'Consignación bancaria',
  '47': 'Transferencia débito bancaria',
  '48': 'Tarjeta crédito',
  '49': 'Tarjeta débito',
};

export function dianPaymentMeanLabel(code: string): string {
  return DIAN_PAYMENT_MEAN_LABEL[code] ?? `Código ${code}`;
}

export interface PaymentMeanResolution {
  code: string;
  /** true si hubo que caer a "instrumento no definido". */
  isFallback: boolean;
}

/**
 * @param franchise `AnalysisPack.providerFranchise` tal como lo reportó la
 *   pasarela. ePayco manda 'N/A' cuando no aplica.
 */
export function toDianPaymentMean(
  franchise: string | null | undefined,
): PaymentMeanResolution {
  // Se normaliza porque la pasarela no promete may/minúsculas ni espaciado, y
  // hay valores compuestos ('NEQUI PAY'): basta con la primera palabra.
  const key = franchise
    ?.trim()
    .toUpperCase()
    .split(/[\s_-]/)[0];
  if (!key || key === 'N/A' || key === 'NA') {
    return { code: DIAN_PAYMENT_MEAN.undefined, isFallback: true };
  }

  const code = FRANCHISE_TO_DIAN[key];
  return code
    ? { code, isFallback: false }
    : { code: DIAN_PAYMENT_MEAN.undefined, isFallback: true };
}
