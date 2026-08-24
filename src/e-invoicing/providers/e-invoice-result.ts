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
  | 'pending'
  /** Anulado ante el facturador. */
  | 'cancelled';

/** Estado CRUDO del facturador, tal como lo reporta. Se archiva y se muestra. */
export interface EInvoiceProviderStatus {
  /** Estado del documento en su contabilidad ('Vigente', 'Pagada', 'Invalida'…). */
  document: string | null;
  /** Etapa ante la DIAN ('Emision', 'Anulacion'…). */
  dianStage: string | null;
  /** Veredicto de la DIAN ('Valida', 'Invalida'…). */
  dianState: string | null;
}

export interface EInvoiceResult {
  status: EInvoiceStatus;
  /** Motivos que devuelve la DIAN. Vacío cuando fue aceptado sin observaciones. */
  reasons: string[];

  /** Id del documento en el proveedor (para reconsultar o anular). */
  externalId: string | null;
  /** Número completo tal como quedó ('SETP994121930'). */
  number: string | null;
  /** Huella del documento ante la DIAN. Sin esto no hay factura válida. */
  cufe: string | null;
  /** Contenido del QR (incluye la URL del catálogo de la DIAN). */
  qrData: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;

  /**
   * Total con el que quedó el documento SEGÚN EL FACTURADOR. Con esta API los
   * importes los calcula él, así que este es el único número que dice por cuánto
   * se facturó de verdad — hay que contrastarlo con lo que se cobró.
   */
  totalAmount: number | null;
  providerStatus: EInvoiceProviderStatus;

  httpStatus: number;
  /** Respuesta CRUDA y completa del proveedor. Es la evidencia; se archiva. */
  raw: unknown;
}
