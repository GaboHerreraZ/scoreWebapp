import type {
  InvoiceDocument,
  InvoiceEnvironment,
} from '../domain/invoice-document.js';
import type { EInvoiceRef, EInvoiceResult } from './e-invoice-result.js';

export const E_INVOICE_PROVIDER = Symbol('E_INVOICE_PROVIDER');

/**
 * Puerto al proveedor de facturación electrónica. Misma forma que
 * ICreditBureauProvider: el service solo conoce esta interfaz y los tipos de
 * dominio, así que cambiar de proveedor es escribir una carpeta nueva y una
 * línea del módulo.
 */
export interface IEInvoiceProvider {
  readonly name: string;

  /** Ambiente en el que emite (viene de configuración, no del documento). */
  readonly environment: InvoiceEnvironment;

  /** Emite una factura de venta. Nunca lanza por un rechazo de la DIAN: eso
   *  viene en el `status` del resultado. Sí lanza si la llamada no se pudo
   *  completar (red, credenciales, 5xx). */
  issueInvoice(doc: InvoiceDocument): Promise<EInvoiceResult>;

  /** Reconsulta el estado de un documento que quedó 'pending'. */
  getStatus(ref: EInvoiceRef): Promise<EInvoiceResult>;
}
