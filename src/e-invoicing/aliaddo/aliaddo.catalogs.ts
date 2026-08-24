/**
 * Traducciones propias de Aliaddo. Aquí va SOLO lo que se inventó el proveedor;
 * los códigos de la DIAN (identificación, régimen, responsabilidades, DANE)
 * viven en domain/dian.catalogs.ts porque son estándar nacional.
 */
import type { InvoicePaymentForm } from '../domain/invoice-document.js';
import type { AliaddoPersonKind, AliaddoRateKind } from './aliaddo.types.js';

/** Forma de pago del documento: contado o crédito. */
export const ALIADDO_PAYMENT_FORM = { cash: 'CN', credit: 'CR' } as const;

/**
 * Tipos de identificación que acepta POST /people. Es un subconjunto del
 * catálogo DIAN: faltan '12' (tarjeta de identidad) y '48' (PPT), que sí están
 * en nuestro Parameter 'identification_type'. Un adquirente con uno de esos NO
 * se puede dar de alta como tercero, y hay que decirlo antes de intentarlo.
 */
export const ALIADDO_IDENTIFICATION_TYPES = new Set([
  '13', // Cédula de ciudadanía
  '21', // Tarjeta de extranjería
  '22', // Cédula de extranjería
  '31', // NIT
  '41', // Pasaporte
  '42', // Documento de identificación extranjero
  '47', // PEP
  '50', // NIT de otro país
  '91', // NUIP
]);

/** Sucursal habilitada. Aliaddo no documenta el conjunto cerrado de `status`. */
export const ALIADDO_BRANCH_ENABLED = 'Enabled';

/** Forma de pago del dominio → código de Aliaddo. */
export function toAliaddoPaymentFormCode(form: InvoicePaymentForm): string {
  return ALIADDO_PAYMENT_FORM[form];
}

/** Persona jurídica → 'Company'. Todo lo demás es 'Person'. */
export function toAliaddoPersonKind(isLegalEntity: boolean): AliaddoPersonKind {
  return isLegalEntity ? 'Company' : 'Person';
}

/** Solo el porcentual sirve como IVA de una línea. */
export function isPercentageRate(kind: AliaddoRateKind | undefined): boolean {
  return kind === 'Porcentaje';
}

/**
 * Normaliza un estado de Aliaddo: sin tildes y en minúscula. Usa etiquetas en
 * español y no documenta el conjunto cerrado, así que se decide por prefijo.
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // quita las tildes
    .toLowerCase();
}

/** `stateDian`: la DIAN validó el documento. */
export function isDianValid(state: string | null | undefined): boolean {
  if (!state) return false;
  const s = normalize(state);
  return s.startsWith('valid') || s.startsWith('aprobad');
}

/** `stateDian`: la DIAN lo rechazó. Ojo: 'Invalida' empieza por 'inval'. */
export function isDianRejected(state: string | null | undefined): boolean {
  if (!state) return false;
  const s = normalize(state);
  return s.startsWith('inval') || s.startsWith('rechazad');
}

/** `status` contable: el documento fue anulado. */
export function isVoidedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return normalize(status).startsWith('inval');
}
