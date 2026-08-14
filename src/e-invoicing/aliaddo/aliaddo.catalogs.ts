/**
 * Traducciones propias de Aliaddo. Aquí va SOLO lo que se inventó el proveedor;
 * los códigos de la DIAN (identificación, régimen, responsabilidades, DANE)
 * viven en domain/dian.catalogs.ts porque son estándar nacional.
 */
import type {
  InvoiceEnvironment,
  InvoicePaymentForm,
} from '../domain/invoice-document.js';
import type { AliaddoMode } from './aliaddo.types.js';

/** Tipo de documento: factura electrónica de venta nacional. */
export const ALIADDO_DOCUMENT_CODE_INVOICE = '01';

/** Modalidad de la operación: estándar. */
export const ALIADDO_TYPE_OPERATION_STANDARD = '10';

/**
 * Plantilla visual del PDF. Es cosmético y propio de Aliaddo (28 valores entre
 * Standard, Continental, Spreadsheet, Minimalist y POS, con variantes de color).
 *
 * Se envía EXPLÍCITO en vez de omitirlo: la documentación advierte que omitirlo
 * "cuando el flujo lo requiere" es un error común, y depender de un default no
 * documentado deja la apariencia de nuestras facturas en manos del proveedor.
 */
export const ALIADDO_PDF_FORMAT = 'Standard';

/** Los impuestos se expresan como porcentaje, no como valor fijo. */
export const ALIADDO_TAX_TYPE_PERCENT = 'P';

/** Código DIAN del IVA. */
export const ALIADDO_TAX_CODE_VAT = '01';

/** `responsibleFor` cuando el adquirente no es responsable de ningún tributo. */
export const ALIADDO_RESPONSIBLE_FOR_NONE = 'ZZ';
/** `responsibleFor` cuando es responsable de IVA. */
export const ALIADDO_RESPONSIBLE_FOR_VAT = '01';

/**
 * Ambiente del dominio → enum `mode` de Aliaddo. Traducción exhaustiva: el
 * ambiente ya viene validado (parseInvoiceEnvironment), así que aquí no hay
 * default que pueda degradar producción a pruebas por accidente.
 */
export function toAliaddoMode(environment: InvoiceEnvironment): AliaddoMode {
  switch (environment) {
    case 'production':
      return 'Production';
    case 'habilitation':
      return 'Habilitation';
    case 'test':
      return 'Test';
  }
}

/**
 * Forma de pago → `termDay`. Aliaddo no recibe un enum contado/crédito en este
 * endpoint: lo deduce del plazo, así que contado va con 0 días.
 */
export function toAliaddoTermDay(
  form: InvoicePaymentForm,
  termDays: number,
): number {
  return form === 'cash' ? 0 : termDays;
}

/**
 * ¿La respuesta significa aceptado? Aliaddo usa etiquetas en español y no
 * documenta el conjunto cerrado, así que se normaliza sin tildes y se decide
 * por prefijo: 'Aprobada' / 'Rechazada' son las dos vistas en la documentación.
 */
function normalizeStatus(status: string): string {
  return status
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita las tildes
    .toLowerCase();
}

export function isAcceptedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = normalizeStatus(status);
  return s.startsWith('aprobad') || s.startsWith('valid');
}

export function isRejectedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = normalizeStatus(status);
  return s.startsWith('rechazad') || s.startsWith('invalid');
}
