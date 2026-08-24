import type {
  BillingContact,
  ContactQuery,
  ProviderAccount,
  ProviderBranch,
  ProviderItem,
  ProviderItemInput,
  ProviderOption,
  ProviderTax,
} from '../domain/billing-catalog.js';
import type {
  InvoiceDocument,
  InvoiceEnvironment,
  InvoiceParty,
} from '../domain/invoice-document.js';
import type { EInvoiceResult } from './e-invoice-result.js';

export const E_INVOICE_PROVIDER = Symbol('E_INVOICE_PROVIDER');

/**
 * Puerto al facturador. Misma forma que ICreditBureauProvider: el service solo
 * conoce esta interfaz y los tipos de dominio, así que cambiar de proveedor es
 * escribir una carpeta nueva y una línea del módulo.
 *
 * Tiene tres bloques porque la API contable exige los tres: emitir documentos,
 * mantener el directorio de terceros y mantener el catálogo de productos. En una
 * API que reciba el documento completo, los dos últimos se implementan como
 * no-ops y el resto del sistema no se entera.
 */
export interface IEInvoiceProvider {
  readonly name: string;

  /** Ambiente declarado en configuración (ver InvoiceEnvironment: no lo fuerza). */
  readonly environment: InvoiceEnvironment;

  // ── Documentos ──────────────────────────────────────────────────────────

  /** Emite una factura de venta. Nunca lanza por un rechazo de la DIAN: eso
   *  viene en el `status` del resultado. Sí lanza si la llamada no se pudo
   *  completar (red, credenciales, 5xx). */
  issueInvoice(doc: InvoiceDocument): Promise<EInvoiceResult>;

  /** Reconsulta un documento ya emitido por su ref en el facturador. */
  getInvoice(externalId: string): Promise<EInvoiceResult>;

  /** Anula un documento. `paymentAccountCode` es obligatorio si nació pagado. */
  voidInvoice(
    externalId: string,
    options?: { paymentAccountCode?: string | null },
  ): Promise<EInvoiceResult>;

  // ── Terceros ────────────────────────────────────────────────────────────

  /** Busca en el directorio. Devuelve vacío si no hay coincidencias. */
  findContacts(query: ContactQuery): Promise<BillingContact[]>;

  /** Da de alta al adquirente como cliente, a partir de su perfil fiscal. */
  createContact(party: InvoiceParty): Promise<BillingContact>;

  /**
   * ¿Puede dar de alta a un tercero con este tipo de documento DIAN? No todos
   * los facturadores aceptan el catálogo completo, y enterarse al pulsar "crear"
   * es tarde: la venta ya está cobrada.
   */
  supportsIdentificationType(dianCode: string): boolean;

  // ── Catálogo de productos ───────────────────────────────────────────────

  listItems(query?: { code?: string }): Promise<ProviderItem[]>;
  createItem(input: ProviderItemInput): Promise<ProviderItem>;
  updateItem(
    externalId: string,
    input: ProviderItemInput,
  ): Promise<ProviderItem>;
  deleteItem(externalId: string): Promise<void>;

  // ── Catálogos de apoyo (alimentan las pantallas del panel) ──────────────

  listTaxes(): Promise<ProviderTax[]>;
  listItemCategories(): Promise<ProviderOption[]>;
  listMeasuringUnits(): Promise<ProviderOption[]>;
  listBranches(): Promise<ProviderBranch[]>;
  listPaymentAccounts(): Promise<ProviderAccount[]>;

  /** Sucursal por defecto, ya resuelta (configurada o la que el facturador marque). */
  resolveDefaultBranchRef(): Promise<string | null>;
}
