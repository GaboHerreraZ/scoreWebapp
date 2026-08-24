/**
 * Tipos CRUDOS de la API contable de Aliaddo (nitro.aliaddo.net).
 *
 * Nada de esto sale de la carpeta `aliaddo/`: el mapper traduce desde y hacia
 * los tipos de dominio.
 *
 * Ojo con dos cosas al leer los payloads:
 *   - La respuesta es camelCase (la otra API de Aliaddo devolvía PascalCase).
 *   - En `details` los importes viajan como STRING, no como número. Es como lo
 *     documenta el endpoint y no hay que "arreglarlo".
 */

// ── Terceros (/people) ────────────────────────────────────────────────────

export type AliaddoPersonKind = 'Person' | 'Company';

export interface AliaddoPersonEmail {
  email: string;
  isValid?: string; // 'Valido' | …
  isMain?: boolean;
}

export interface AliaddoPersonAddress {
  name: string;
  address: string;
  countryCode: string; // ISO 3166-1 alfa-2
  /** En Colombia: el CÓDIGO del departamento. Fuera: el nombre. */
  region: string;
  /** En Colombia: el CÓDIGO del municipio. Fuera: el nombre. */
  city: string;
  postalCode?: string;
  neighborhood?: string;
  phone?: string;
  isForBilling?: boolean;
  isForShipping?: boolean;
  isDefault?: boolean;
}

export interface AliaddoPerson {
  id: string;
  kind: AliaddoPersonKind;
  identificationType: string; // código DIAN
  identification: string;
  firstName?: string;
  secondName?: string;
  firstSurname?: string;
  secondSurname?: string;
  companyName?: string;
  phoneMobile?: string;
  phoneWork?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
  isEmployee?: boolean;
  isSeller?: boolean;
  emails?: AliaddoPersonEmail[];
}

export interface AliaddoPersonRequest {
  kind: AliaddoPersonKind;
  identificationType: string;
  identification: string;
  identificationCheck?: string; // DV del NIT
  firstName?: string;
  secondName?: string;
  firstSurname?: string;
  secondSurname?: string;
  companyName?: string;
  phoneMobile?: string;
  phoneWork?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
  emails?: { email: string; isMain?: boolean }[];
  addresses?: AliaddoPersonAddress[];
}

/** POST /people y POST|PUT /items responden solo con el id y el nombre. */
export interface AliaddoCreatedRef {
  id: string;
  name?: string;
}

// ── Impuestos (/taxes) ────────────────────────────────────────────────────

/** 'Porcentaje' es el único que sirve para IVA; los otros son valores fijos. */
export type AliaddoRateKind = 'Porcentaje' | 'ValorFijo' | 'PorMil';

export interface AliaddoTax {
  id: string;
  name: string;
  categoryCode: string; // '01' IVA
  categoryName: string;
  rate: number;
  rateKind: AliaddoRateKind;
  includedInPrice: boolean;
}

// ── Productos (/items) ────────────────────────────────────────────────────

export interface AliaddoItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  categoryId?: string;
  unitMeasurementId?: string;
  taxes?: AliaddoTax[];
  withholdings?: AliaddoTax[];
  isForBuy?: boolean;
  isForSell?: boolean;
  cost?: number;
  priceBuy?: number;
  priceSell?: number;
  hasInventoryControl?: boolean;
  stock?: number;
}

export interface AliaddoItemRequest {
  code: string;
  name: string;
  description?: string;
  categoryId?: string;
  unitMeasurementId?: string;
  taxes?: { id: string }[];
  withholdings?: { id: string }[];
  isForBuy?: boolean;
  isForSell?: boolean;
  priceSell?: number;
  hasInventoryControl?: boolean;
}

// ── Catálogos de apoyo ────────────────────────────────────────────────────

export interface AliaddoBranch {
  id: string;
  name: string;
  isDefault?: boolean;
  status?: string; // 'Enabled' | …
}

export interface AliaddoItemCategory {
  id: string;
  name: string;
  image?: string | null;
  enabled?: boolean;
}

export interface AliaddoMeasuringUnit {
  id: string;
  code: string;
  name: string;
  category?: string;
  enabled?: boolean;
}

export interface AliaddoChartAccount {
  id?: string;
  code: string;
  name: string;
}

// ── Facturas (/invoices) ──────────────────────────────────────────────────

export interface AliaddoInvoiceDetail {
  /** Precio unitario ANTES de impuestos. String, no número. */
  unitValueBeforeTax: string;
  itemCode: string;
  quantity: string;
  warehouseId?: string;
  description?: string;
  discountAmount?: number;
  discountIsPercent?: boolean;
  taxes?: { id: string }[];
  withholdings?: { id: string }[];
}

export interface AliaddoInvoiceRequest {
  personId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  /** 'CN' contado | 'CR' crédito. */
  paymentFormCode: string;
  /** Código DIAN del medio de pago ('10' efectivo, '48' tarjeta…). */
  paymentMeanCode: string;
  currencyCode?: string;
  exchangeRate?: number;
  /** Cuenta contable del recaudo: con esto la factura nace pagada. */
  accountCodePayment?: string;
  purchaseOrderNumber?: string;
  costCenterId?: string;
  personIdSeller?: string;
  observation?: string;
  customerNote?: string;
  termsAndConditions?: string;
  details: AliaddoInvoiceDetail[];
}

/**
 * Respuesta de POST /invoices y GET /invoices/{id}. Los dos endpoints devuelven
 * formas distintas del mismo documento (el GET trae más), así que va todo
 * opcional y el mapper toma lo que haya.
 */
export interface AliaddoInvoiceResponse {
  id?: string;
  consecutive?: string;
  createdAt?: string;
  /** Estado contable: 'Vigente' | 'Pagada' | 'PagoParcial' | 'Invalida' | … */
  status?: string;
  /** Etapa ante la DIAN: 'Emision' | 'Anulacion' | … */
  statusDian?: string;
  /** Veredicto de la DIAN: 'Valida' | 'Invalida' | … */
  stateDian?: string;
  stateDianReason?: string[];
  stateDianDate?: string;
  cufe?: string;
  qr?: string;
  urlPdf?: string;
  urlXml?: string;

  // Solo en GET /invoices/{id}.
  personId?: string;
  personName?: string;
  branchId?: string;
  subtotalAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  balanceAmount?: number;
}
