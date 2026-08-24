/**
 * Maestros del facturador, en términos del DOMINIO.
 *
 * La API contable no recibe el documento fiscal completo: la factura REFERENCIA
 * terceros, productos, impuestos y sucursales que ya existen en la cuenta del
 * facturador. Estos tipos son cómo los ve el resto del sistema; la forma cruda
 * (y el nombre del proveedor) no salen de su carpeta.
 *
 * `ref` es siempre el identificador que el facturador usa para esa entidad, sin
 * suponer que sea un uuid, un código o un entero.
 */

/** Persona o empresa en el directorio del facturador. */
export interface BillingContact {
  ref: string;
  /** Razón social o nombre completo, tal como lo tiene el facturador. */
  displayName: string;
  identificationTypeCode: string; // código DIAN ('31' NIT, '13' CC…)
  identificationNumber: string;
  /** true si es persona jurídica en el facturador. */
  isLegalEntity: boolean;
  /** Marcado como cliente. En false NO se le puede facturar sin corregirlo. */
  isCustomer: boolean;
  email: string | null;
  phone: string | null;
}

/**
 * Búsqueda en el directorio. Los tres filtros son "contiene", no exactos, y el
 * facturador no ofrece búsqueda por nombre: la llave real es la identificación.
 */
export interface ContactQuery {
  identification?: string;
  email?: string;
  phone?: string;
  /** null = buscar en los dos (personas y empresas). */
  isLegalEntity?: boolean | null;
}

/** Impuesto configurado en el facturador. */
export interface ProviderTax {
  ref: string;
  name: string;
  /** Código DIAN del tributo ('01' IVA, '04' INC…). */
  categoryCode: string;
  categoryName: string;
  /** 19 si es porcentaje; el valor absoluto si es fijo. */
  rate: number;
  /** Porcentaje, valor fijo o por mil. Solo el porcentaje sirve para el IVA. */
  isPercentage: boolean;
  includedInPrice: boolean;
}

/** Producto del catálogo del facturador. */
export interface ProviderItem {
  ref: string;
  code: string;
  name: string;
  description: string | null;
  priceSell: number | null;
  taxes: ProviderTax[];
}

/** Lo que hace falta para crear o actualizar un producto allá. */
export interface ProviderItemInput {
  code: string;
  name: string;
  description: string | null;
  priceSell: number | null;
  /** Refs de los impuestos que aplican. Vacío = producto excluido de IVA. */
  taxRefs: string[];
  /** Ref de la categoría y la unidad de medida del facturador. */
  categoryRef: string | null;
  measuringUnitRef: string | null;
}

/** Sucursal desde la que se emite. */
export interface ProviderBranch {
  ref: string;
  name: string;
  isDefault: boolean;
  isEnabled: boolean;
  /**
   * Estado tal como lo reporta el facturador ('Enabled'…). `isEnabled` es la
   * lectura de dominio; esto es la etiqueta cruda, para poder diagnosticar sin
   * entrar al portal del proveedor.
   */
  statusLabel: string | null;
}

/** Cuenta contable (bancos/caja) contra la que se registra el recaudo. */
export interface ProviderAccount {
  code: string;
  name: string;
}

/** Opción simple de un catálogo del facturador (categorías, unidades…). */
export interface ProviderOption {
  ref: string;
  code: string | null;
  name: string;
  isEnabled: boolean;
}

/**
 * Impuesto tal como queda ARCHIVADO en `einvoice_items.provider_tax_ids`.
 *
 * Vive aquí y no en el servicio de ítems porque lo escriben unos y lo leen
 * otros: el catálogo lo guarda al sincronizar, la emisión lo lee para armar la
 * línea. Es un jsonb, así que la lectura tolera cualquier otra forma.
 */
export interface StoredTax {
  ref: string;
  name: string | null;
  rate: number | null;
}

export function toStoredTax(tax: ProviderTax): StoredTax {
  return { ref: tax.ref, name: tax.name, rate: tax.rate };
}

/** Refs de impuesto archivados, ignorando lo que no tenga la forma esperada. */
export function storedTaxRefs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) =>
      typeof entry === 'object' && entry !== null
        ? (entry as StoredTax).ref
        : null,
    )
    .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
}
