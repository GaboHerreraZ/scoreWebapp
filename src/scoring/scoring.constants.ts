// ─── Constantes del modelo de scoring ──────────────────────────────────────
// Los pesos de las 7 dimensiones del análisis de viabilidad. Cada empresa tiene
// su propia ScoringConfiguration versionada; estos son los DEFAULT del sistema
// que se aplican al crear la empresa (y como referencia de validación).

/** Las 7 dimensiones del scoring, en el orden canónico. */
export const SCORING_DIMENSIONS = [
  'financialHealth',
  'paymentCapacity',
  'termCoherence',
  'creditLineAdequacy',
  'capitalExposure',
  'veracity',
  'centralRisk',
] as const;

export type ScoringDimension = (typeof SCORING_DIMENSIONS)[number];

/** Los pesos deben sumar EXACTAMENTE esto. */
export const TOTAL_WEIGHT = 100;

/** Peso mínimo por dimensión: nadie puede apagar una dimensión (p. ej. veracidad). */
export const MIN_WEIGHT = 5;

/**
 * Mapa dimensión → nombre de la columna de peso en ScoringConfiguration.
 * Fuente única para no repetir el mapeo en repo/servicio/validación.
 */
export const DIMENSION_WEIGHT_FIELD: Record<ScoringDimension, string> = {
  financialHealth: 'weightFinancialHealth',
  paymentCapacity: 'weightPaymentCapacity',
  termCoherence: 'weightTermCoherence',
  creditLineAdequacy: 'weightCreditLineAdequacy',
  capitalExposure: 'weightCapitalExposure',
  veracity: 'weightVeracity',
  centralRisk: 'weightCentralRisk',
};

/** Codes del Parameter person_type. */
export type PersonTypeCode = 'naturalPerson' | 'legalEntity';

/** En PN la Veracidad NO aplica (Experian no da EEFF de PN → no hay contraste). */
export const VERACITY_APPLIES: Record<PersonTypeCode, boolean> = {
  legalEntity: true,
  naturalPerson: false,
};

/**
 * Pesos DEFAULT para PERSONA JURÍDICA (7 dimensiones, suman 100). Prioriza
 * capacidad de pago y veracidad (que pueda pagar y que no mienta), luego riesgo
 * de central y salud financiera.
 */
export const DEFAULT_WEIGHTS_PJ: Record<ScoringDimension, number> = {
  paymentCapacity: 20,
  veracity: 20,
  centralRisk: 15,
  financialHealth: 15,
  creditLineAdequacy: 12,
  capitalExposure: 10,
  termCoherence: 8,
};

/**
 * Pesos DEFAULT para PERSONA NATURAL (6 dimensiones, suman 100). NO hay
 * veracidad (=0: sin contraste posible); a cambio pesa MÁS el riesgo de la
 * central (es la señal más confiable para PN). Los 20 puntos de veracidad de PJ
 * se redistribuyen: +10 a central, +6 a capacidad, +4 a salud.
 */
export const DEFAULT_WEIGHTS_PN: Record<ScoringDimension, number> = {
  paymentCapacity: 26,
  centralRisk: 25,
  financialHealth: 19,
  creditLineAdequacy: 12,
  capitalExposure: 10,
  termCoherence: 8,
  veracity: 0,
};

/** Pesos default según el tipo de persona. */
export function defaultWeightsFor(
  personType: PersonTypeCode,
): Record<ScoringDimension, number> {
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

// ─── Techo de la central (montoSugerido de DataCrédito Experian) ────────────
// La central devuelve un `montoSugerido`: el monto máximo que avala para el
// cliente. Creditia NUNCA aprueba por encima de ese techo. Cuando el cupo
// solicitado lo supera, se penaliza la Adecuación del cupo (Dim 4) y el Riesgo
// de la central (Dim 7), y el monto aprobado se recorta al montoSugerido.
//
// Tolerancia antes de castigo fuerte: un exceso leve (≤ este múltiplo) baja el
// ratio parcialmente; por encima, cae a 0.
export const SUGGESTED_AMOUNT_SOFT_EXCESS = 1.3; // 30% por encima del techo
// Penalización a la Dim 7 cuando el cupo solicitado supera el techo de la central.
export const CENTRAL_OVERASK_PENALTY = 0.15;

// ─── Cap de veredicto por banda de riesgo de la central ─────────────────────
// La central es la FUENTE DE VERDAD sobre riesgo crediticio; un PDF auto-
// reportado no puede "aprobar" a un cliente que la central marca como riesgo
// alto. Si el score de la central cae por debajo de este piso (o el nivel es
// MÁXIMO), el mejor veredicto posible es 'conditional' (nunca 'approved'),
// aunque el score total supere el umbral de aprobación.
export const CENTRAL_SCORE_CONDITIONAL_CAP = 500; // < 500 → tope 'conditional'
export const CENTRAL_MAX_RISK_LEVELS = ['maximo', 'alto']; // nivelRiesgo normalizado
