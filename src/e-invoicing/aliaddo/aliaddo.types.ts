/**
 * Tipos CRUDOS de la API de Aliaddo (POST /v2/documents/invoices).
 * Nada de esto sale de la carpeta `aliaddo/`: el mapper traduce desde y hacia
 * los tipos de dominio.
 */

export type AliaddoMode = 'Test' | 'Habilitation' | 'Production';

export interface AliaddoAddress {
  address: string;
  countryCode: string;
  countryName: string;
  regionCode: string;
  regionName: string;
  cityCode: string;
  cityName: string;
  phone?: string;
}

export interface AliaddoResolution {
  key: string;
  prefix: string;
  number: number;
  rangeInitial: number;
  rangeFinal: number;
  validFrom: string; // YYYY-MM-DD
  validUntil: string;
}

export interface AliaddoCustomer {
  companyName: string;
  personType: string; // '1' jurídica | '2' natural
  regimeType: string; // '48' | '49'
  firstName: string;
  lastName: string;
  identification: string;
  digitCheck: string;
  identificationTypeCode: string;
  email?: string;
  phone?: string;
  responsibleFor?: string; // '01' IVA | '04' INC | 'ZA' | 'ZZ'
  responsibilities: string; // 'O-13', 'R-99-PN'…
  BillingAddress: AliaddoAddress;
}

export interface AliaddoTax {
  name: string;
  code: string;
  type: string; // 'P' porcentaje | 'F' fijo
  rate: number;
  amount: number;
  base: number;
}

export interface AliaddoLine {
  code: string;
  name: string;
  description?: string;
  unitMeasurementCode: string;
  price: number;
  quantity: number;
  taxes: AliaddoTax[];
}

export interface AliaddoTotals {
  amount: number;
  prepaymentAmount: number;
  taxesAmount: number;
  withholdingAmount: number;
  discountsAmount: number;
  chargesAmount: number;
}

export interface AliaddoInvoiceRequest {
  code: string; // '01' factura de venta nacional
  typeOperation: string; // '10' estándar
  mode: AliaddoMode;
  /** Plantilla visual del PDF ('Standard', 'Minimalist', 'PosX80mm'…). */
  format: string;
  testSetId?: string;
  prefix: string;
  consecutive: number;
  currencyCode: string;
  dueAt: string; // YYYY-MM-DD
  paymentMeanCode: string;
  termDay?: number;
  orderReference?: string;
  resolution: AliaddoResolution;
  // `branch` es opcional y no se envía: Aliaddo la toma de la empresa.
  customer: AliaddoCustomer;
  lines: AliaddoLine[];
  totals: AliaddoTotals;
  notes?: string[];
  remark?: string;
}

/** Respuesta 200. Ojo con el PascalCase: es como lo devuelve Aliaddo. */
export interface AliaddoInvoiceResponse {
  Id?: string;
  Cufe?: string;
  Sequence?: string;
  Qr?: string;
  Status?: string; // 'Aprobada' | 'Rechazada'…
  StatusReasons?: string[];
  UrlPdf?: string;
  UrlXml?: string;
}
