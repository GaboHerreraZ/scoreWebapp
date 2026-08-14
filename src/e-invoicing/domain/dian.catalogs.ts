/**
 * Códigos de los catálogos de la DIAN.
 *
 * Viven en el dominio, NO en el adaptador del proveedor: son estándar nacional
 * y cualquier proveedor colombiano de facturación electrónica usa exactamente
 * los mismos. Lo que sí es del proveedor (nombres de campos, modos de ambiente,
 * sus enums propios) va en su carpeta.
 *
 * Solo se traduce lo que ya existía como concepto del dominio antes de facturar
 * — los tipos de identificación. El régimen y las responsabilidades fiscales
 * nacieron con la factura, así que su Parameter.code YA es el código DIAN y no
 * necesitan mapa.
 */

/** Tipo de persona (DIAN). Se deriva del tipo de documento, no se pregunta. */
export const DIAN_PERSON_TYPE = {
  legal: '1', // jurídica
  natural: '2',
} as const;

/**
 * code del Parameter 'identification_type' → código DIAN.
 * https://docs.aliaddo.com/tipos-de-identificacion-2171097m0
 */
export const DIAN_IDENTIFICATION_TYPE: Record<string, string> = {
  cc: '13', // Cédula de ciudadanía
  nit: '31', // NIT
  ce: '22', // Cédula de extranjería
  pas: '41', // Pasaporte
  ti: '12', // Tarjeta de identidad
  ppt: '48', // Permiso por Protección Temporal
  pep: '47', // Permiso Especial de Permanencia
  dni: '42', // Documento de identificación extranjero
  pje: '50', // NIT de otro país (persona jurídica extranjera)
};

/** Documentos que identifican a una persona JURÍDICA. El resto son naturales. */
const LEGAL_ENTITY_DOC_CODES = new Set(['nit', 'pje']);

/** Régimen frente al IVA (Parameter 'tax_regime'; el code ya es el de la DIAN). */
export const DIAN_TAX_REGIME = {
  vatResponsible: '48',
  notVatResponsible: '49',
} as const;

/** Responsabilidad por defecto cuando el adquirente no tiene ninguna especial. */
export const DIAN_DEFAULT_RESPONSIBILITY = 'R-99-PN';

/** Unidad de medida por defecto ('94' = unidad). El servicio no se vende por peso. */
export const DIAN_UNIT_MEASUREMENT_UNIT = '94';

/** País del adquirente. Hoy solo se factura en Colombia. */
export const DIAN_COUNTRY = { code: 'CO', name: 'Colombia' } as const;

/** Traduce el code del Parameter al de la DIAN. null si no está mapeado. */
export function toDianIdentificationType(
  parameterCode: string | null | undefined,
): string | null {
  if (!parameterCode) return null;
  return DIAN_IDENTIFICATION_TYPE[parameterCode] ?? null;
}

/** Jurídica o natural según el tipo de documento. */
export function toDianPersonType(
  parameterCode: string | null | undefined,
): (typeof DIAN_PERSON_TYPE)[keyof typeof DIAN_PERSON_TYPE] {
  return parameterCode && LEGAL_ENTITY_DOC_CODES.has(parameterCode)
    ? DIAN_PERSON_TYPE.legal
    : DIAN_PERSON_TYPE.natural;
}

/** true si el documento identifica a una persona jurídica. */
export function isLegalEntityDocument(
  parameterCode: string | null | undefined,
): boolean {
  return !!parameterCode && LEGAL_ENTITY_DOC_CODES.has(parameterCode);
}
