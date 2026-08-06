/**
 * Cálculo del precio de una bolsa (PackOffering), DERIVADO del precio de
 * consulta vigente. El catálogo NO guarda un precio absoluto: se calcula al
 * vuelo = quantity × unitPrice − descuento por volumen opcional.
 *
 * El descuento se interpreta según el code del Parameter 'discount_type':
 *   'percentage' → discountValue es un % sobre el subtotal (10 = 10%).
 *   'fixed'      → discountValue es un monto fijo a restar (5000 = $5.000).
 * Cualquier otro code (o sin descuento) deja el subtotal intacto.
 */

export type DiscountTypeCode = 'percentage' | 'fixed';

export interface PackPriceInput {
  quantity: number;
  unitPrice: number;
  hasDiscount: boolean;
  discountTypeCode?: DiscountTypeCode | string | null;
  discountValue?: number | null;
}

export interface PackPrice {
  unitPrice: number; // precio unitario vigente usado
  subtotal: number; // quantity × unitPrice (sin descuento)
  discountAmount: number; // cuánto se descontó (>= 0)
  total: number; // subtotal − discountAmount (nunca < 0)
}

/**
 * Redondeo comercial ("precio gancho"): lleva el valor al millar más cercano y
 * le resta 1, para que el precio siempre termine en .999 ($1.180.999).
 *
 * Es la misma regla de la calculadora de descuentos del portal, pero al revés:
 * allí el TOTAL es la fuente de verdad y el % mostrado es una lectura derivada
 * y redondeada a un decimal. Aquí lo que se guarda es el %, así que recalcular
 * desde él arroja un valor a unos cientos de pesos del precio pensado
 * (21,3% guardado ≠ 21,26515% real → $1.180.476 en vez de $1.180.999) y con
 * decimales sueltos. Ajustar el total y derivar el descuento por diferencia
 * cierra las dos cosas y sobrevive a un cambio del precio por consulta.
 *
 * Por debajo de $1.000 no hay millar al que redondear: se devuelve el entero.
 */
export function roundToCharmPrice(amount: number): number {
  if (!Number.isFinite(amount) || amount < 1000) return Math.round(amount);
  return Math.round(amount / 1000) * 1000 - 1;
}

export function calculatePackPrice(input: PackPriceInput): PackPrice {
  const { quantity, unitPrice, hasDiscount, discountTypeCode, discountValue } =
    input;

  const subtotal = Math.round(quantity * unitPrice);

  let rawDiscount = 0;
  if (hasDiscount && discountValue && discountValue > 0) {
    if (discountTypeCode === 'percentage') {
      rawDiscount = subtotal * (discountValue / 100);
    } else if (discountTypeCode === 'fixed') {
      rawDiscount = discountValue;
    }
  }

  // Sin descuento el precio es el subtotal tal cual (2 × $49.999 = $99.998): no
  // se "embellece", porque ahí el número no lo produce este cálculo sino el
  // precio por consulta vigente, que es decisión del catálogo de precios.
  if (rawDiscount <= 0) {
    return { unitPrice, subtotal, discountAmount: 0, total: subtotal };
  }

  // Con descuento manda el TOTAL: se ajusta a .999 y el descuento sale por
  // diferencia, de modo que siempre se cumple total = subtotal − discountAmount
  // y ningún consumidor (ePayco, factura, correo) recibe centavos. El clamp
  // evita que un descuento desproporcionado deje el total negativo, o que el
  // redondeo hacia arriba lo empuje por encima del subtotal.
  const total = Math.min(
    Math.max(roundToCharmPrice(subtotal - rawDiscount), 0),
    subtotal,
  );

  return { unitPrice, subtotal, discountAmount: subtotal - total, total };
}

/**
 * Desglose de IVA de un valor comercial (ya con todos los descuentos aplicados).
 * La tarifa y el modo vienen del ConsultationPrice vigente, porque el IVA cambia
 * con los años y la factura debe emitirse con el que rigió en la compra.
 *
 *   taxIncluded = true  → `amount` YA trae el IVA: se desglosa hacia atrás
 *                         (base = amount / (1 + tasa)) y el cobro NO cambia.
 *   taxIncluded = false → `amount` es la base gravable: el IVA se SUMA, así que
 *                         el cobro al cliente sube.
 *
 * Invariante: total = base + taxAmount (se redondea la base y el IVA sale por
 * diferencia, para que nunca haya un peso de descuadre en la factura).
 */
export interface TaxBreakdown {
  taxRate: number; // porcentaje aplicado (19 = 19%)
  taxIncluded: boolean; // cómo se interpretó el valor de entrada
  base: number; // base gravable
  taxAmount: number; // impuesto
  total: number; // lo que se cobra realmente
}

export function calculateTax(
  amount: number,
  taxRate: number,
  taxIncluded: boolean,
): TaxBreakdown {
  const rate = taxRate > 0 ? taxRate : 0;

  if (amount <= 0 || rate === 0) {
    return {
      taxRate: rate,
      taxIncluded,
      base: amount,
      taxAmount: 0,
      total: amount,
    };
  }

  if (taxIncluded) {
    const base = Math.round(amount / (1 + rate / 100));
    return {
      taxRate: rate,
      taxIncluded,
      base,
      taxAmount: amount - base,
      total: amount,
    };
  }

  const taxAmount = Math.round(amount * (rate / 100));
  return {
    taxRate: rate,
    taxIncluded,
    base: amount,
    taxAmount,
    total: amount + taxAmount,
  };
}
