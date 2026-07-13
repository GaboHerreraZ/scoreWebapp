// ─── CATÁLOGOS DE EXPERIAN (Manual MiDecisor API v1.0, Tablas 1–15) ─────────
// Diccionarios código → descripción tal como los define el manual oficial de
// DataCrédito Experian. Parte de la capa anticorrupción: SOLO el mapper los usa
// para producir los `*Label` de dominio (texto neutro). Si se cambia de central,
// el nuevo provider trae sus propios catálogos y el dominio no se entera.
//
// Todas las lookups son case-insensitive-safe vía translate(): normalizan la
// clave y caen a null si el código no está en el catálogo (nunca lanzan).

/** Traduce un código contra un catálogo. Devuelve null si no hay match o el código es vacío. */
export function translate(
  catalog: Record<string, string>,
  code: string | null | undefined,
): string | null {
  if (code === null || code === undefined) return null;
  const key = String(code).trim();
  if (key === '') return null;
  return catalog[key] ?? catalog[key.toUpperCase()] ?? null;
}

// Tabla 1 — Códigos de transacción (clave TX). Rangos 01-08 (éxito) y 09-16
// (fallida) se resuelven por función, el resto es lookup directo.
const TX_EXACT: Record<string, string> = {
  '17': 'No se ha encontrado información en nuestros registros para validar la empresa consultada',
  '20': 'Campo requerido faltante',
  '21': 'Tipo de identificación inválido (Longitud mayor a 1)',
  '22': 'Formato del NIT inválido (Incluye caracteres o es mayor a 11 números)',
  '23': 'Excepción interna',
  '24': 'Formato razón social inválido (Números o caracteres especiales)',
  '25': 'Combinación de módulos inválida',
  '-': 'Sin información disponible/Error en la consulta',
};

/** Describe un código de respuesta TX (Tabla 1). Maneja los rangos 01-08 / 09-16. */
export function describeTxCode(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const v = String(valor).trim();
  if (v === '') return null;
  const n = Number(v);
  if (Number.isInteger(n)) {
    if (n >= 1 && n <= 8) return 'Consulta exitosa';
    if (n >= 9 && n <= 16) return 'Consulta fallida';
  }
  return TX_EXACT[v] ?? null;
}

// Tabla 5 — Organización jurídica (PJ). key = valor tal cual llega (mayúsculas).
export const LEGAL_ORGANIZATION: Record<string, string> = {
  'SIN ASIGNACION ORGANIZACION JURIDICA': 'Sin asignación organización jurídica',
  'PERSONA NATURAL': 'Persona natural',
  CIVIL: 'Civil',
  'EMPRESA UNIPERSONAL': 'Empresa unipersonal',
  'ESAL REGIMEN COMUN': 'Esal régimen común',
  'ESAL REGIMEN ESPECIAL': 'Esal régimen especial',
  'FONDO DE PENSION DE JUBILACION': 'Fondo de pensión de jubilación',
  'SOCIEDAD POR ACCIONES SIMPLIFICADA': 'Sociedad por acciones simplificada',
  'EMPRESA INDUSTRIAL Y COMERCIAL DEL ESTADO':
    'Empresa industrial y comercial del estado',
  'SOCIEDAD AGRARIA DE TRANSFORMACION': 'Sociedad agraria de transformación',
  CONSORCIOS: 'Consorcios',
  ESTABLECIMIENTO: 'Establecimiento',
  'AFILIADOS ESPECIALES NO MATRICULADOS':
    'Afiliados especiales no matriculados',
  'ESAL VEEDURIAS': 'Esal veedurías',
  'ESAL EXTRANJERAS': 'Esal extranjeras',
  LIMITADA: 'Limitada',
  ANONIMA: 'Anónima',
  COLECTIVA: 'Colectiva',
  'COMANDITA SIMPLE': 'Comandita simple',
  'COMANDITA POR ACCIONES': 'Comandita por acciones',
  EXTRANJERA: 'Extranjera',
  'EMPRESA ASOCIATIVA DE TRABAJO': 'Empresa asociativa de trabajo',
  '-': 'No se tiene información',
};

// Tabla 6 — Entidad con embargo (PJ).
export const SEIZED: Record<string, string> = {
  Si: 'Empresa tiene embargos activos',
  No: 'Empresa sin embargos',
  '-': 'No se tiene información',
};

// Tabla 7 — Entidad en liquidación (PJ).
export const IN_LIQUIDATION: Record<string, string> = {
  Si: 'Empresa en liquidación',
  No: 'Empresa no está en liquidación',
  '-': 'No se tiene información',
};

// Tabla 8 — Tipos de crédito (PJ).
export const CREDIT_TYPE: Record<string, string> = {
  Comercial: 'Créditos u obligaciones comerciales',
  Consumo: 'Obligaciones o créditos de consumo',
  Microcredito: 'Microcréditos',
  Hipotecario: 'Créditos hipotecarios',
};

// Tabla 9 — Comportamiento de pago (PN + PJ).
export const PAYMENT_BEHAVIOR: Record<string, string> = {
  N: 'Al día',
  '1': 'Mora de 30 días',
  '2': 'Mora de 60 días',
  '3': 'Mora de 90 días',
  '4': 'Mora de 120 días',
  '5': 'Mora de 150 días',
  '6': 'Mora de 180 días',
  C: 'Cartera castigada',
  D: 'Dudoso recaudo',
  '-': 'No existe información disponible para este mes en específico',
  ' ': 'No existe información disponible para este mes en específico',
};

// Tabla 10 — Tipo de sectores (PN + PJ).
export const SECTOR: Record<string, string> = {
  'Sector Financiero':
    'Instituciones financieras (bancos, cooperativas financieras, compañías de financiamiento)',
  'Sector Real':
    'Empresas del sector real de la economía (comercio, industria, servicios)',
  'Sector Cooperativo':
    'Cooperativas de ahorro y crédito, fondos de empleados, etc',
  'Sector Telcos': 'Empresas de telecomunicaciones y servicios públicos',
};

// Tabla 11 — Viabilidad de pago (PN).
export const VIABILITY: Record<string, string> = {
  ALTA: 'Cliente con alta probabilidad de pago',
  MEDIA: 'Cliente con probabilidad media de pago',
  BAJA: 'Cliente con baja probabilidad de pago',
};

// Tabla 12 — Rating de facilidad de recaudo (PN).
export const COLLECTION_RATING: Record<string, string> = {
  A: 'Este tipo de clientes suele cumplir con sus obligaciones solo con el envío de la factura',
  B: 'Este tipo de clientes suele cumplir con sus obligaciones con el envío de su factura y una acción de cobranza en tono amable con intensidad moderada como recordación de pago',
  C: 'Este tipo de clientes suele cumplir con sus obligaciones con el envío de su factura y una acción de cobranza contundente con intensidad alta',
  D: 'Requiere reestructuración o acuerdo de pago',
  N: 'Sin información suficiente para calificar',
};

// Tabla 13 — Nivel de riesgo (PJ). También aplica a Tabla 14 (riesgo sectorial),
// mismo mapeo código→descripción.
export const RISK_LEVEL: Record<string, string> = {
  '1': 'Riesgo mínimo',
  '2': 'Riesgo bajo',
  '3': 'Riesgo medio',
  '4': 'Riesgo alto',
  '5': 'Riesgo máximo',
  '0': 'Sin información suficiente para calificar',
};

// Tabla 14 — Riesgo del sector (PJ). Mismo esquema numérico que RISK_LEVEL.
export const SECTORAL_RISK = RISK_LEVEL;

// Tabla 15 — Tipos de vinculados (PJ).
export const LINK_TYPE: Record<string, string> = {
  alertado: 'El registro tiene alertas relacionadas a listas restrictivas',
  ejecutivo:
    'El registro se clasifica como un ejecutivo, es decir, persona natural',
  empresa:
    'El registro se clasifica como una entidad, es decir, persona jurídica',
};
