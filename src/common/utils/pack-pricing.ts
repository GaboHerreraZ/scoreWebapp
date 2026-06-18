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

export function calculatePackPrice(input: PackPriceInput): PackPrice {
  const { quantity, unitPrice, hasDiscount, discountTypeCode, discountValue } =
    input;

  const subtotal = quantity * unitPrice;

  let discountAmount = 0;
  if (hasDiscount && discountValue && discountValue > 0) {
    if (discountTypeCode === 'percentage') {
      discountAmount = subtotal * (discountValue / 100);
    } else if (discountTypeCode === 'fixed') {
      discountAmount = discountValue;
    }
  }

  // El descuento nunca puede dejar el total negativo.
  discountAmount = Math.min(discountAmount, subtotal);
  const total = subtotal - discountAmount;

  return { unitPrice, subtotal, discountAmount, total };
}
