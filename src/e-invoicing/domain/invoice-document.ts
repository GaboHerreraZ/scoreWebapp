/**
 * Documento fiscal en términos del DOMINIO. Ningún nombre, enum ni forma de
 * aquí pertenece a un proveedor concreto: el service arma esto y el adaptador
 * lo traduce. Cambiar de proveedor no debe tocar este archivo.
 *
 * Los códigos que sí viajan tal cual (identificación, régimen, municipio) son
 * de la DIAN, no del proveedor — ver domain/dian.catalogs.ts.
 */

/** Municipio + departamento, ya resueltos contra el catálogo DIVIPOLA. */
export interface InvoiceLocation {
  cityCode: string; // '68001'
  cityName: string; // el nombre EXACTO del catálogo DIAN
  regionCode: string; // '68'
  regionName: string; // 'Santander'
}

export interface InvoiceAddress extends InvoiceLocation {
  address: string;
  countryCode: string; // 'CO'
  countryName: string; // 'Colombia'
  phone: string | null;
}

/** Emisor o adquirente. */
export interface InvoiceParty {
  /** Razón social (PJ) o nombre completo (PN). Siempre presente. */
  legalName: string;
  firstName: string | null;
  lastName: string | null;
  identificationTypeCode: string; // código DIAN ('31' NIT, '13' CC…)
  identificationNumber: string;
  /** DV del NIT. Calculado, no almacenado. Vacío si no aplica. */
  verificationDigit: string;
  personType: string; // código DIAN: '1' jurídica, '2' natural
  regimeCode: string; // '48' | '49'
  fiscalResponsibilities: string[]; // ['O-13', 'R-99-PN'…]
  email: string | null;
  phone: string | null;
  address: InvoiceAddress;
}

/** Impuesto de una línea. base × rate = amount. */
export interface InvoiceTax {
  name: string; // 'IVA'
  code: string; // '01' IVA, '04' INC…
  rate: number; // 19
  base: number;
  amount: number;
}

export interface InvoiceLine {
  code: string; // código del ítem ('PACK-CONSULTAS')
  name: string;
  description: string | null;
  quantity: number;
  /** Precio unitario ANTES de impuestos. */
  unitPrice: number;
  unitMeasurementCode: string; // '94' unidad
  taxes: InvoiceTax[];
}

/**
 * Resolución de facturación de la DIAN. La emite la DIAN al obligado y define
 * el prefijo, el rango de numeración autorizado y su vigencia. Con esta API el
 * consecutivo lo llevamos nosotros, así que va aquí y no lo pone el proveedor.
 */
export interface InvoiceResolution {
  /** Clave técnica que entrega la DIAN junto con la resolución. */
  key: string;
  prefix: string;
  /** Número de la resolución (no del documento). */
  number: number;
  rangeInitial: number;
  rangeFinal: number;
  validFrom: Date;
  validUntil: Date;
}

export type InvoicePaymentForm = 'cash' | 'credit';

/** Totales del documento. amount = suma de líneas antes de impuestos. */
export interface InvoiceTotals {
  amount: number;
  taxesAmount: number;
  discountsAmount: number;
  chargesAmount: number;
  withholdingAmount: number;
}

/**
 * El documento no lleva emisor: lo aporta el proveedor desde la empresa que
 * tiene configurada. Si algún día Creditia factura a nombre de sus clientes,
 * vuelve a entrar aquí como `issuer: InvoiceParty`.
 */
export interface InvoiceDocument {
  /** Consecutivo YA asignado (reservado de forma atómica antes de emitir). */
  consecutive: number;
  resolution: InvoiceResolution;
  customer: InvoiceParty;

  issueDate: Date;
  dueDate: Date;
  currency: string; // 'COP'
  paymentForm: InvoicePaymentForm;
  /** Código DIAN del medio de pago ('10' efectivo, '48' tarjeta…). */
  paymentMeanCode: string;
  /** Días de plazo. 0 en contado. */
  termDays: number;

  lines: InvoiceLine[];
  totals: InvoiceTotals;

  /** Observaciones que van al pie del documento. */
  notes: string[];
  /** Referencia propia (id de la bolsa) para trazabilidad. */
  reference: string | null;
}

/**
 * Ambiente de emisión ante la DIAN. Es un concepto del DOMINIO, no del
 * proveedor: los tres existen en cualquier proveedor colombiano, y el adaptador
 * los traduce a su propio enum.
 *
 *   test         — documentos SIN efectos legales. Para probar la integración.
 *   habilitation — validaciones previas a producción (set de pruebas de la DIAN).
 *   production   — documentos con efectos tributarios, financieros y comerciales.
 */
export type InvoiceEnvironment = 'test' | 'habilitation' | 'production';

const ENVIRONMENTS: InvoiceEnvironment[] = [
  'test',
  'habilitation',
  'production',
];

/**
 * Lee el ambiente de configuración. Falla RUIDOSAMENTE ante un valor
 * desconocido en vez de caer a un default: un typo que degrade producción a
 * pruebas emitiría documentos sin validez legal creyendo que factura de verdad,
 * y nadie se enteraría hasta que la DIAN reclame.
 */
export function parseInvoiceEnvironment(
  value: string | undefined,
): InvoiceEnvironment {
  const normalized = (value ?? '').trim().toLowerCase();
  const match = ENVIRONMENTS.find((env) => env === normalized);
  if (!match) {
    throw new Error(
      `EINVOICE_ENVIRONMENT='${value ?? ''}' no es válido. Use: ${ENVIRONMENTS.join(' | ')}`,
    );
  }
  return match;
}
