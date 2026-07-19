import type { ScoringDimension, EnabledWeights } from './scoring.constants.js';

// ─── Entrada del motor de scoring ───────────────────────────────────────────
// El motor es una función PURA: recibe todo lo que necesita ya resuelto (no lee
// BD). El servicio arma esta entrada leyendo el estudio, el análisis financiero
// (DataCrédito como fuente de verdad), el PDF (para contraste) y el snapshot de
// riesgo de Experian.

/** Cifras crudas de un año (subset relevante para el contraste de veracidad). */
export interface GrossFigures {
  ordinaryActivityRevenue: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  netIncome: number | null;
}

/** Indicadores ya calculados (por el helper) sobre la fuente de verdad. */
export interface ScoringIndicators {
  monthlyPaymentCapacity: number;
  annualPaymentCapacity: number;
  currentDebtService: number;
  ebitda: number;
  accountsReceivableTurnover: number;
  inventoryTurnover: number;
  paymentTimeSuppliers: number;
  stabilityFactor: number; // 1 | 0.66 | 0.33 (Z-Altman → escalón)
}

/** Un mes del vector de comportamiento de pago de la central. */
export interface PaymentBehaviorMonth {
  anioMes: string | null; // 'YYYY-M'
  comportamiento: string | null; // 'N' | '1'..'6' | 'C' | 'D' | '-'
}

/** Datos de riesgo de Experian para la Dim 7. null si no hay consulta. */
export interface CentralRiskInput {
  nivelRiesgo: string | null; // 'BAJO' | 'MEDIO' | 'ALTO'
  ratingSectorial: string | null; // '0'..'5' o 'ALTO'/'BAJO'...
  hasArrears: boolean; // ¿el vector de comportamiento muestra mora? (derivado)
  /** Vector de comportamiento de pago (mora por mes). Para graduar por severidad
   *  y recencia. Ordenado del mes más antiguo al más reciente (como lo da la
   *  central). null/[] si no hay información. */
  paymentBehavior: PaymentBehaviorMonth[] | null;
  score: number | null; // puntaje Experian (referencia)
  montoSugerido: number | null; // referencia de la central (señal/alerta, NO techo)
  porcentajeDeuda: number | null; // % de deuda usada (endeudamiento en la central)
  saldoMora: number | null; // saldo actualmente en mora ($)
  /** Ingreso mensual reportado por la central (solo PN). Referencia de capacidad
   *  de pago para contrastar contra los EEFF del PDF. null en PJ. */
  reportedIncome: number | null;
  /** % del ingreso ya comprometido en cuotas vigentes (solo PN). */
  quotaToIncomePct: number | null;
}

/**
 * Estado legal del cliente (de la central / cámara de comercio). Señales que
 * pueden ser ELIMINATORIAS: una empresa con matrícula cancelada o en liquidación
 * no es sujeto de crédito. null si no hay perfil de bureau (p. ej. PN).
 */
export interface LegalStatusInput {
  registrationStatus: string | null; // 'Activa' | 'Cancelada' | ...
  inLiquidation: string | null; // 'Sí' | 'No' | ...
}

/** La solicitud del estudio (lo que pide el cliente). */
export interface StudyRequest {
  requestedTerm: number | null; // días
  requestedCreditLine: number | null; // $
}

export interface ScoringEngineInput {
  /**
   * Pesos de las dimensiones HABILITADAS por la config de la empresa. Una
   * dimensión ausente está deshabilitada: no se evalúa, no aparece en el
   * resultado y no participa del score. (Las reglas eliminatorias del motor
   * aplican SIEMPRE, independiente de qué dimensiones estén habilitadas.)
   */
  weights: EnabledWeights;
  /**
   * Labels de display por dimensión (del catálogo scoring_dimensions). El motor
   * cae a sus labels internos si faltan (p. ej. config default en memoria).
   */
  labels?: Partial<Record<ScoringDimension, string>>;
  request: StudyRequest;
  indicators: ScoringIndicators;
  /**
   * Tipo de persona del cliente. Determina el trato de la Veracidad (Dim 6):
   * en PJ es SIEMPRE evaluable (la empresa está obligada a reportar EEFF a la
   * central; si no hay con qué contrastar, la veracidad puntúa 0). En PN no
   * aplica (la central no reporta EEFF de PN) → no evaluable, se redistribuye.
   */
  personType: 'legalEntity' | 'naturalPerson';
  /** Año corriente de la fuente de verdad (DataCrédito). null → no evaluable. */
  truthFigures: GrossFigures | null;
  /** Año corriente del PDF, mismo fiscalYear que truth. null → sin contraste. */
  pdfFigures: GrossFigures | null;
  /** Riesgo de la central. null → Dim 7 no evaluable. */
  centralRisk: CentralRiskInput | null;
  /** Estado legal (matrícula / liquidación). Puede ser eliminatorio. */
  legalStatus: LegalStatusInput | null;
}

// ─── Salida del motor ───────────────────────────────────────────────────────

export interface DimensionResult {
  dimension: ScoringDimension;
  label: string;
  /** Puntaje relativo 0..1 (1 = cumple del todo). null si no evaluable. */
  ratio: number | null;
  /** Peso EFECTIVO tras redistribución (0..100). */
  weight: number;
  /** Puntos aportados = ratio × weight. 0 si no evaluable. */
  contribution: number;
  status: string;
  evaluable: boolean;
}

export interface ScoringAlert {
  type: 'success' | 'warning' | 'danger' | 'info';
  dimension: string;
  message: string;
}

export interface ScoringResult {
  dimensions: Record<string, DimensionResult>;
  alerts: ScoringAlert[];
  reference: {
    experianScore: number | null;
    experianSuggestedAmount: number | null;
    experianRiskLevel: string | null;
  };
  /**
   * Monto que Creditia avala. Lo mandan los EEFF (sean de DataCrédito o del
   * PDF): es el cupo solicitado si cabe en el máximo pagable según la capacidad
   * de pago para el plazo pedido; si pide de más, se recorta a ese máximo. El
   * `montoSugerido` de la central NO recorta (suele ser conservador frente a la
   * realidad del cliente): queda como referencia y genera alertas si el pedido
   * lo supera por mucho.
   */
  approvedCreditLine: {
    amount: number | null; // $ avalado por Creditia (según EEFF)
    requested: number | null; // $ que pidió el cliente
    suggestedByBureau: number | null; // referencia de la central (montoSugerido)
    cappedByCapacity: boolean; // true si se recortó al máximo pagable según EEFF
  };
  /**
   * Cifras clave del análisis, ya calculadas, para que el front las MUESTRE como
   * datos (no solo embebidas en el texto de las alertas). Todas sobre la fuente
   * usada por el motor. Ayudan al cliente a entender el "porqué" del veredicto.
   */
  keyFigures: {
    // ── Capacidad de pago vs cuota ──
    monthlyPaymentCapacity: number; // $/mes que el cliente puede destinar a pagar
    annualPaymentCapacity: number; // $/año
    estimatedMonthlyQuota: number; // $/mes de la cuota del cupo solicitado
    /** Veces que la capacidad cubre la cuota (>1 = holgura). null si cuota 0. */
    paymentCoverageRatio: number | null;
    currentDebtService: number; // servicio de deuda actual ($/año)
    ebitda: number;
    // ── Ciclo operativo (días) ──
    accountsReceivableTurnover: number; // rotación de cartera (días en cobrar)
    inventoryTurnover: number; // rotación de inventarios (días)
    paymentTimeSuppliers: number; // días en pagar a proveedores
    /** Ciclo de conversión de caja = cartera + inventario − proveedores (días). */
    cashConversionCycle: number;
    stabilityFactor: number; // 1 | 0.66 | 0.33 (Z-Altman → escalón)
  };
  summary: {
    totalScore: number; // 0..100
    maxScore: 100;
    status: 'approved' | 'conditional' | 'rejected';
    /** Con qué cifras se calculó. 'datacredito' = fuente de verdad (oficial). */
    calculationSource: 'datacredito' | 'pdf' | 'none';
    /**
     * true solo si el cálculo corrió sobre DataCrédito (fuente de verdad) Y hubo
     * un PDF para contrastar veracidad. false = análisis sobre cifras
     * auto-reportadas o sin contraste; el cliente debe considerarlo al decidir.
     */
    financialsVerified: boolean;
    /**
     * Si el veredicto fue 'rejected' por una regla ELIMINATORIA (no por score),
     * describe el motivo (matrícula cancelada, en liquidación, capacidad de pago
     * negativa). null si el veredicto salió del score.
     */
    eliminatoryReason: string | null;
  };
  /**
   * Red flags derivadas de la CENTRAL de riesgo (estado legal, mora, endeudamiento,
   * monto sugerido 0). Distintas de las del PDF: estas vienen de DataCrédito, no
   * del documento del cliente. Las produce el motor.
   */
  centralRiskFlags: CentralRiskFlag[];
  /**
   * Red flags de FIABILIDAD del PDF, detectadas por la IA al EXTRAER los estados
   * financieros (balance que no cuadra, utilidad sospechosa, cuentas con socios,
   * etc.). Auditan el PDF contra sí mismo — distinto del contraste de veracidad
   * (Dim 6), que compara el PDF con DataCrédito. Solo existen si hubo PDF; en un
   * estudio sin PDF es un arreglo vacío. Las rellena el servicio (el motor no las
   * conoce), copiándolas del análisis de fuente `pdf`.
   */
  pdfReliabilityFlags: PdfReliabilityFlag[];
}

/** Una red flag de fiabilidad del PDF (generada al extraer los EEFF). */
export interface PdfReliabilityFlag {
  severity: 'danger' | 'warning' | 'info';
  /** Código estable (balance, resultados, relacionados, tendencia, notas, legibilidad, otro). */
  category: string;
  /** Etiqueta legible en español (para mostrar al cliente). */
  categoryLabel: string;
  title: string;
  detail: string;
}

/**
 * Una red flag derivada de la central de riesgo (la produce el motor a partir del
 * snapshot). category acota el origen: 'legal_status' (matrícula/liquidación),
 * 'payment_behavior' (vector de mora), 'indebtedness' (endeudamiento/saldo en
 * mora), 'suggested_amount' (montoSugerido 0), 'score' (puntaje muy bajo).
 */
export type CentralRiskFlagCategory =
  | 'legal_status'
  | 'payment_behavior'
  | 'indebtedness'
  | 'suggested_amount'
  | 'score';

export interface CentralRiskFlag {
  severity: 'danger' | 'warning' | 'info';
  /** Código estable (para íconos/filtros en el front). */
  category: CentralRiskFlagCategory;
  /** Etiqueta legible en español (para mostrar al cliente). */
  categoryLabel: string;
  title: string;
  detail: string;
}
