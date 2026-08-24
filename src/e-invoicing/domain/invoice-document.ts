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

  /** Ref del producto en el catálogo del facturador. */
  itemRef: string;
  /** Refs de los impuestos que aplican allá. Vacío = línea sin IVA. */
  taxRefs: string[];
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
 * El documento no lleva emisor ni numeración: los aporta el facturador desde la
 * empresa y la resolución que tiene configuradas. Si algún día Creditia factura
 * a nombre de sus clientes, vuelve a entrar aquí como `issuer: InvoiceParty`.
 */
export interface InvoiceDocument {
  /** Ref del tercero en el facturador. Ya resuelto: el adaptador no lo busca. */
  contactRef: string;
  /** Sucursal desde la que se emite. null = la que el facturador tenga por defecto. */
  branchRef: string | null;
  /**
   * Cuenta contable del recaudo. Si viene, la factura nace PAGADA en vez de
   * quedar como cartera abierta — que es lo correcto aquí: el cliente ya pagó
   * antes de que existiera la factura.
   */
  paymentAccountCode: string | null;

  /**
   * Adquirente. NO viaja al facturador (allá va `contactRef`): es el snapshot
   * congelado de a quién se le facturó, que la empresa puede cambiar después.
   */
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
  /**
   * Totales esperados. NO se envían — con esta API los calcula el facturador —
   * pero se conservan para contrastarlos contra los que devuelva: si no casan,
   * la factura salió por otro valor y hay que enterarse.
   */
  totals: InvoiceTotals;

  /** Observaciones que van al pie del documento. */
  notes: string[];
  /** Referencia propia (id de la bolsa) para trazabilidad. */
  reference: string | null;
}

/**
 * Ambiente de emisión ante la DIAN.
 *
 * ⚠️ Con la API contable esto NO viaja en el payload: el ambiente real es una
 * propiedad de la CUENTA del facturador a la que pertenece el token. Aquí es una
 * etiqueta declarada: se archiva con el documento y alimenta las advertencias del
 * panel, pero no puede forzar nada. Un token de producción factura en producción
 * aunque esto diga 'test' — por eso hay que declararlo bien.
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
