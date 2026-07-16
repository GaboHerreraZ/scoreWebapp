// ─── Constantes del modelo de scoring ──────────────────────────────────────
// Las dimensiones del análisis de viabilidad. El CATÁLOGO comercial (label,
// description, isActive) vive en la tabla scoring_dimensions; aquí vive el
// COMPORTAMIENTO: qué dimensiones soporta el motor, cuáles son obligatorias,
// a qué tipo de persona aplican y los pesos default al crear una empresa.

/** Dimensiones SOPORTADAS por el motor, en el orden canónico. Una fila del
 *  catálogo cuyo code no esté aquí no se puede habilitar (no hay eval*). */
export const SCORING_DIMENSIONS = [
  'financialHealth',
  'paymentCapacity',
  'termCoherence',
  'capitalExposure',
  'veracity',
  'centralRisk',
] as const;

export type ScoringDimension = (typeof SCORING_DIMENSIONS)[number];

/**
 * Pesos de las dimensiones HABILITADAS por una configuración. Una dimensión
 * ausente está deshabilitada: no se evalúa ni participa del estudio.
 */
export type EnabledWeights = Partial<Record<ScoringDimension, number>>;

/** Los pesos habilitados deben sumar EXACTAMENTE esto. */
export const TOTAL_WEIGHT = 100;

/** Peso mínimo por dimensión habilitada (habilitada con peso simbólico = apagada de facto). */
export const MIN_WEIGHT = 5;

/** Codes del Parameter person_type. */
export type PersonTypeCode = 'naturalPerson' | 'legalEntity';

/** Reglas de negocio de una dimensión (viven en código, no en BD: cambian solo
 *  cuando cambia el motor y no deben ser editables por datos). */
export interface DimensionRules {
  /** true = núcleo del análisis: la empresa NO la puede deshabilitar. */
  required: boolean;
  /** A qué tipos de persona aplica (veracity no aplica a PN: sin contraste posible). */
  appliesTo: Record<PersonTypeCode, boolean>;
}

/**
 * Reglas por dimensión. Capacidad de pago y riesgo de la central son el núcleo
 * del estudio (sin ellas el "estudio de crédito" pierde sentido) → obligatorias.
 * Las demás son opcionales: cada empresa decide si participan.
 */
export const DIMENSION_RULES: Record<ScoringDimension, DimensionRules> = {
  financialHealth: {
    required: false,
    appliesTo: { legalEntity: true, naturalPerson: true },
  },
  // Integra la antigua "Adecuación del cupo" (Dim 4): además de la cuota,
  // analiza el cupo pedido vs el máximo pagable según los EEFF en el plazo.
  paymentCapacity: {
    required: true,
    appliesTo: { legalEntity: true, naturalPerson: true },
  },
  termCoherence: {
    required: false,
    appliesTo: { legalEntity: true, naturalPerson: true },
  },
  capitalExposure: {
    required: false,
    appliesTo: { legalEntity: true, naturalPerson: true },
  },
  // En PN la Veracidad NO aplica (Experian no da EEFF de PN → no hay contraste).
  veracity: {
    required: false,
    appliesTo: { legalEntity: true, naturalPerson: false },
  },
  centralRisk: {
    required: true,
    appliesTo: { legalEntity: true, naturalPerson: true },
  },
};

/**
 * Pesos DEFAULT para PERSONA JURÍDICA (las 6 habilitadas, suman 100). Prioriza
 * capacidad de pago y veracidad (que pueda pagar y que no mienta), luego riesgo
 * de central y salud financiera. La capacidad de pago absorbe los 12 puntos de
 * la antigua "Adecuación del cupo" (fusionada en ella).
 */
export const DEFAULT_WEIGHTS_PJ: EnabledWeights = {
  paymentCapacity: 32,
  veracity: 20,
  centralRisk: 15,
  financialHealth: 15,
  capitalExposure: 10,
  termCoherence: 8,
};

/**
 * Pesos DEFAULT para PERSONA NATURAL (5 habilitadas, suman 100). La veracidad
 * NO aplica (sin contraste posible) → no se habilita; a cambio pesa MÁS el
 * riesgo de la central (es la señal más confiable para PN). La capacidad de
 * pago absorbe los 12 puntos de la antigua "Adecuación del cupo".
 */
export const DEFAULT_WEIGHTS_PN: EnabledWeights = {
  paymentCapacity: 38,
  centralRisk: 25,
  financialHealth: 19,
  capitalExposure: 10,
  termCoherence: 8,
};

/** Pesos default según el tipo de persona. */
export function defaultWeightsFor(personType: PersonTypeCode): EnabledWeights {
  return personType === 'legalEntity' ? DEFAULT_WEIGHTS_PJ : DEFAULT_WEIGHTS_PN;
}

// ─── Bandas del puntaje de DataCrédito Experian (escala 150-950) ────────────
// Interpretación estándar del score (Comparabien/Semana/Portafolio, 2026). El
// umbral de "buen puntaje" del mercado es 700; el promedio colombiano ronda 630.
// Se usan en la Dim 7 (Riesgo de la central) para mapear el score a un ratio
// 0..1. Constantes en un solo lugar: si el proveedor ajusta la escala, se toca
// aquí. `min` es el piso inclusivo de cada banda; están en orden ascendente.
export interface ScoreBand {
  min: number; // puntaje mínimo (inclusivo) de la banda
  ratio: number; // aporte 0..1 a la dimensión
  label: string; // etiqueta legible (para display)
  code: string; // código estable
}

export const SCORE_BANDS: ScoreBand[] = [
  { min: 750, ratio: 1.0, label: 'Excelente', code: 'excellent' },
  { min: 700, ratio: 0.8, label: 'Bueno', code: 'good' },
  { min: 650, ratio: 0.6, label: 'Aceptable', code: 'acceptable' },
  { min: 500, ratio: 0.4, label: 'Regular', code: 'fair' },
  { min: 0, ratio: 0.0, label: 'Riesgo alto', code: 'high_risk' },
];

/** Mapea un puntaje al ratio/label de su banda. Devuelve la banda más baja si es null. */
export function scoreToBand(score: number | null): ScoreBand {
  if (score === null) return SCORE_BANDS[SCORE_BANDS.length - 1];
  for (const band of SCORE_BANDS) {
    if (score >= band.min) return band;
  }
  return SCORE_BANDS[SCORE_BANDS.length - 1];
}

// ─── Estado legal eliminatorio (matrícula / liquidación) ────────────────────
// Una empresa con matrícula cancelada o en liquidación NO es sujeto de crédito:
// el veredicto es 'rejected' sin importar el score. Se comparan normalizados
// (minúsculas, sin tildes). El campo confiable es validacion.matricula.estado.
export const REGISTRATION_CANCELLED_VALUES = ['cancelada', 'cancelado'];
export const IN_LIQUIDATION_VALUES = ['si', 'sí', 'true', 'en liquidacion'];

// ─── Vector de comportamiento de pago (mora graduada por severidad y recencia) ─
// Códigos de la central (Tabla PAYMENT_BEHAVIOR): 'N'=al día; '1'..'6'=mora de
// 30..180 días; 'C'=cartera castigada; 'D'=dudoso recaudo; '-'/' '=sin dato.
// Severidad 0..1: cuánto pesa cada código como señal de mora.
export const ARREARS_SEVERITY: Record<string, number> = {
  N: 0,
  '1': 0.3,
  '2': 0.45,
  '3': 0.6,
  '4': 0.75,
  '5': 0.9,
  '6': 1.0,
  C: 1.0, // cartera castigada = lo peor
  D: 1.0, // dudoso recaudo = lo peor
};
// Ventana de "recencia": los meses recientes pesan más. Se ponderan los últimos
// N meses del vector (el más reciente al final) con un factor decreciente.
export const ARREARS_RECENT_WINDOW = 6; // meses recientes que más pesan
// Penalización MÁXIMA a la Dim 7 por mora (se escala por severidad×recencia).
export const ARREARS_MAX_PENALTY = 0.4;
// Umbrales para clasificar la mora en red flags (sobre el índice 0..1 ponderado).
export const ARREARS_FLAG_DANGER = 0.5; // mora severa/reciente → danger
export const ARREARS_FLAG_WARNING = 0.2; // mora moderada → warning

// Etiquetas legibles (español) de las categorías de red flags de la central.
// El código (category) se conserva estable para el front; este label es para
// mostrar al cliente.
export const CENTRAL_RISK_FLAG_CATEGORY_LABEL: Record<string, string> = {
  legal_status: 'Estado legal',
  payment_behavior: 'Comportamiento de pago',
  indebtedness: 'Endeudamiento',
  suggested_amount: 'Monto avalado por la central',
  score: 'Puntaje de la central',
};

// Etiquetas legibles (español) de las categorías de red flags de FIABILIDAD del
// PDF (las produce la IA con estos códigos). Fallback: el código tal cual.
export const PDF_RELIABILITY_FLAG_CATEGORY_LABEL: Record<string, string> = {
  balance: 'Balance general',
  resultados: 'Estado de resultados',
  relacionados: 'Partes relacionadas',
  tendencia: 'Tendencia',
  notas: 'Notas a los estados financieros',
  legibilidad: 'Legibilidad del documento',
  otro: 'Otro',
};

// ─── Endeudamiento (de la central) ──────────────────────────────────────────
// porcentajeDeuda alto = red flag. Umbrales en % (0..100+).
export const DEBT_RATIO_DANGER = 80; // >80% del cupo usado → danger
export const DEBT_RATIO_WARNING = 60; // >60% → warning

// ─── Monto sugerido de la central (señal, NO techo) ─────────────────────────
// La central devuelve un `montoSugerido`. En el mercado real ese monto suele ser
// conservador (muy por debajo de lo que los EEFF del cliente soportan), así que
// NO se usa como techo: el monto lo mandan los EEFF (capacidad de pago × plazo).
// El montoSugerido queda como SEÑAL: si el cupo solicitado lo supera por mucho,
// se generan alertas informativas (sin penalizar el score) para que el analista
// lo pondere. Umbrales como múltiplo del montoSugerido:
export const SUGGESTED_AMOUNT_ALERT_WARNING = 1.5; // pide >1.5× lo sugerido → warning
export const SUGGESTED_AMOUNT_ALERT_DANGER = 3; // pide >3× lo sugerido → danger
// montoSugerido = 0 ("la central no avala ningún monto") tampoco es eliminatorio:
// topa el veredicto en 'conditional' (ver cap de veredicto más abajo) y genera
// red flag; el analista decide con los EEFF a la vista.

// ─── Cap de veredicto por banda de riesgo de la central ─────────────────────
// La central es la FUENTE DE VERDAD sobre riesgo crediticio; un PDF auto-
// reportado no puede "aprobar" a un cliente que la central marca como riesgo
// alto. Si el score de la central cae por debajo de este piso (o el nivel es
// MÁXIMO), el mejor veredicto posible es 'conditional' (nunca 'approved'),
// aunque el score total supere el umbral de aprobación.
export const CENTRAL_SCORE_CONDITIONAL_CAP = 500; // < 500 → tope 'conditional'
export const CENTRAL_MAX_RISK_LEVELS = ['maximo', 'alto']; // nivelRiesgo normalizado
