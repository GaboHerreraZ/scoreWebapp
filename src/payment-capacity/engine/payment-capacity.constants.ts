// ─── Constantes del estudio de capacidad de pago (PN sin EEFF) ─────────────
// Mismo reparto que scoring.constants.ts: el CATÁLOGO comercial (label,
// description) vive en la tabla scoring_dimensions; aquí vive el COMPORTAMIENTO
// del estudio de capacidad: dimensiones soportadas, obligatoriedad, defaults y
// la política de indicadores (§4 del diseño, docs/estudio-persona-natural-diseno.md).

import type {
  DimensionRules,
  PersonTypeCode,
} from '../../scoring/scoring.constants.js';

/** Dimensiones del estudio de capacidad, en orden canónico. centralRisk REUSA
 *  la fila del catálogo del flujo EEFF (mismo code, otra evaluación); las demás
 *  son propias de este estudio.
 *
 *  NO existe aquí una dimensión `paymentCapacity`: la capacidad ES el resultado
 *  del estudio (la cuota máxima sostenible), no un factor de su puntaje.
 *  Puntuarla además sería contarla dos veces, porque la holgura que mediría
 *  (disponible ÷ ingreso) es casi la misma cuenta que el endeudamiento
 *  (cuotas ÷ ingreso). El score mide qué tan CONFIABLE es el perfil; la
 *  magnitud viaja aparte en capacityFigures. */
export const PAYMENT_CAPACITY_DIMENSIONS = [
  'incomeStability',
  'indebtedness',
  'financialBehavior',
  'docVeracity',
  'centralRisk',
] as const;

export type PaymentCapacityDimension =
  (typeof PAYMENT_CAPACITY_DIMENSIONS)[number];

export type PaymentCapacityWeights = Partial<
  Record<PaymentCapacityDimension, number>
>;

/**
 * Reglas por dimensión. Obligatorias: que el ingreso sea estable
 * (incomeStability), que se sepa cuánto de él ya está comprometido
 * (indebtedness) y la señal del buró (centralRisk, MiDecisor PN va 100%
 * incluido). El estudio de capacidad aplica SOLO a persona natural.
 */
export const PAYMENT_CAPACITY_DIMENSION_RULES: Record<
  PaymentCapacityDimension,
  DimensionRules
> = {
  incomeStability: {
    required: true,
    appliesTo: { legalEntity: false, naturalPerson: true },
  },
  // Obligatoria: al no existir dimensión de capacidad, es la única que mide
  // cuánto del ingreso ya se llevan las deudas. Sin ella el estudio quedaría
  // ciego a la carga de deuda.
  indebtedness: {
    required: true,
    appliesTo: { legalEntity: false, naturalPerson: true },
  },
  financialBehavior: {
    required: false,
    appliesTo: { legalEntity: false, naturalPerson: true },
  },
  docVeracity: {
    required: false,
    appliesTo: { legalEntity: false, naturalPerson: true },
  },
  centralRisk: {
    required: true,
    appliesTo: { legalEntity: false, naturalPerson: true },
  },
};

/**
 * Pesos DEFAULT del estudio de capacidad (5 habilitadas, suman 100). Sin plazo
 * ni monto en la ecuación, lo que decide la confianza es que el ingreso se
 * sostenga y que no esté ya comprometido: estabilidad y endeudamiento se llevan
 * la mitad. La central es el único contraste externo; comportamiento y
 * veracidad afinan (si los documentos no son confiables, nada lo es).
 */
export const PAYMENT_CAPACITY_DEFAULT_WEIGHTS: PaymentCapacityWeights = {
  incomeStability: 25,
  indebtedness: 25,
  centralRisk: 20,
  financialBehavior: 15,
  docVeracity: 15,
};

/** El estudio de capacidad solo existe para persona natural. */
export const PAYMENT_CAPACITY_PERSON_TYPE: PersonTypeCode = 'naturalPerson';

// ─── Política de indicadores v1 (fijos; el diseño los prevé configurables v2) ─

/** Cuota máxima sugerida = min(NET_PCT × ingreso neto, AVAILABLE_PCT × disponible). */
export const MAX_INSTALLMENT_NET_PCT = 0.3;
export const MAX_INSTALLMENT_AVAILABLE_PCT = 0.7;

/** Umbrales de DTI (cuotas de crédito ÷ ingreso neto verificado; sin tarjeta). */
export const DTI_HEALTHY = 0.3; // < 30% sano
export const DTI_CRITICAL = 0.45; // > 45% crítico

/** Divergencia entre las cuotas del extracto y las de la central que dispara
 *  flag: la mayor debe superar a la otra en este ratio Y en el mínimo absoluto. */
export const DEBT_DIVERGENCE_RATIO = 1.2;
export const DEBT_DIVERGENCE_MIN = 100_000;

/** Pago de tarjeta sobre el ingreso a partir del cual se pide revisión. No es
 *  deuda comprometida, pero sí es plata que sale todos los meses. */
export const CARD_PAYMENT_REVIEW_PCT = 0.5;

/** Índice de verificación (abono en extracto ÷ neto declarado): < 0.9 → flag. */
export const VERIFICATION_INDEX_FLAG = 0.9;

/** Verificación factura↔abono en moneda extranjera (sin API de TRM en v1):
 *  TRM implícita = abono/total, con banda de plausibilidad + tolerancia. */
export const FX_PLAUSIBLE_MIN = 3500;
export const FX_PLAUSIBLE_MAX = 5500;
export const INVOICE_FX_TOLERANCE = 0.1; // ±10%

/** Factura COP: el cliente puede abonar el total MENOS retenciones
 *  (retefuente por honorarios 10–11% + ICA) → el abono puede llegar
 *  hasta este % por debajo del facturado y aún corresponder. */
export const INVOICE_RETENTION_TOLERANCE = 0.15;

/** Apuestas en línea como % del ingreso mensual (señal de riesgo §4.4). */
export const GAMBLING_WARNING_PCT = 0.05; // > 5% warning
export const GAMBLING_DANGER_PCT = 0.15; // > 15% danger

/** Ventana MÍNIMA de extractos por perfil laboral (meses). Es un piso, no un
 *  tope: quien aporte más meses los ve promediados sobre todos ellos, porque
 *  los indicadores dividen entre los meses realmente cubiertos. */
export const WINDOW_MONTHS_SALARIED = 3;
export const WINDOW_MONTHS_INDEPENDENT = 3;

/** Cardinalidad de documentos por tipo (máximos por estudio). */
export const MAX_PAYROLL_STUBS = 2;
export const MAX_CONTRACTOR_INVOICES = 2;
export const MAX_BANK_STATEMENTS = 12; // holgura: la ventana puede venir en 1..N PDFs
