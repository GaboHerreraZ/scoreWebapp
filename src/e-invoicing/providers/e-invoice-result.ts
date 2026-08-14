/**
 * Resultado de emitir un documento, en términos del dominio. El adaptador
 * traduce aquí la respuesta de su proveedor; nada de la forma cruda cruza.
 */

/** Cómo quedó el documento ante la DIAN. */
export type EInvoiceStatus =
  /** Aceptado: tiene CUFE y efectos legales. */
  | 'accepted'
  /** Rechazado por la DIAN o por el proveedor. `reasons` dice por qué. */
  | 'rejected'
  /** Enviado pero sin veredicto todavía: hay que reconsultar. */
  | 'pending';

export interface EInvoiceResult {
  status: EInvoiceStatus;
  /** Motivos que devuelve la DIAN. Vacío cuando fue aceptado sin observaciones. */
  reasons: string[];

  /** Id del documento en el proveedor (para reconsultar su estado). */
  externalId: string | null;
  /** Número completo tal como quedó ('SETP994121930'). */
  number: string | null;
  /** Huella del documento ante la DIAN. Sin esto no hay factura válida. */
  cufe: string | null;
  /** Contenido del QR (incluye la URL del catálogo de la DIAN). */
  qrData: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;

  httpStatus: number;
  /** Respuesta CRUDA y completa del proveedor. Es la evidencia; se archiva. */
  raw: unknown;
}

/** Referencia para reconsultar un documento ya enviado. */
export interface EInvoiceRef {
  externalId: string | null;
  prefix: string | null;
  consecutive: number | null;
}
