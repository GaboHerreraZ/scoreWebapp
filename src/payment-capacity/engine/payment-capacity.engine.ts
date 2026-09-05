// ─── MOTOR DE SCORING del estudio de capacidad de pago (función pura) ──────
// Mismo contrato de salida que el motor EEFF (ScoringResult): el front, los
// steps, la narrativa y el PDF reutilizan la anatomía del resultado. Cambia el
// CÓMO se evalúa cada dimensión: indicadores de flujo de caja (§4 del diseño)
// en lugar de ratios de estados financieros. Umbrales de veredicto y evaluación
// de la central importados del motor EEFF (misma política).

import {
  APPROVED_THRESHOLD,
  CONDITIONAL_THRESHOLD,
  buildCentralRiskFlags,
  centralMarksHighRisk,
  evalCentralRisk,
  hasNoBureauHistory,
  type RawDimension,
} from '../../scoring/scoring.engine.js';
import type {
  CentralRiskInput,
  ScoringAlert,
  ScoringResult,
  DimensionResult,
  StudyRequest,
} from '../../scoring/scoring.types.js';
import {
  clamp,
  money,
  pct,
  round1,
  round2,
} from '../../common/utils/format.utils.js';
import {
  DTI_CRITICAL,
  DTI_HEALTHY,
  PAYMENT_CAPACITY_DIMENSIONS,
  VERIFICATION_INDEX_FLAG,
  type PaymentCapacityDimension,
  type PaymentCapacityWeights,
} from './payment-capacity.constants.js';
import type { PaymentCapacityIndicatorsResult } from '../indicators/payment-capacity-indicators.js';
import type {
  ReliabilityFlag,
  ValidationOutcome,
} from '../extraction/extraction.types.js';

const LABELS: Record<PaymentCapacityDimension, string> = {
  incomeStability: 'Estabilidad del ingreso',
  indebtedness: 'Endeudamiento',
  financialBehavior: 'Comportamiento financiero',
  docVeracity: 'Veracidad documental',
  centralRisk: 'Riesgo de la central',
};

/** Bloque propio del estudio de capacidad dentro del resultado congelado. */
export interface CapacityFigures {
  verifiedMonthlyIncome: number;
  payrollNetIncome: number | null;
  bankStatementIncome: number;
  incomeVerificationIndex: number | null;
  incomeCv: number | null;
  monthsWithIncome: number;
  coveredMonths: number;
  windowMonths: number;
  /** Compromisos contractuales (arriendo, salud, educación, servicios,
   *  telecom, seguros, suscripciones). NO incluye el costo de vida. */
  recurringFixedExpenses: number;
  /** Todo lo que sale por obligaciones: cuotas + tarjeta. */
  existingDebtPayments: number;
  /** Servicio de deuda comprometido, sin tarjeta: es el que mide el DTI.
   *  Bi-fuente: max(cuotas del extracto, cuota según la central). */
  debtServicePayments: number;
  /** Cuota mensual según la central; null si no trajo el dato. */
  centralMonthlyQuota: number | null;
  /** Pagos a tarjeta: salen de la cuenta, pero no son cuota de deuda. */
  cardPayments: number;
  /** Costo de vida observado (mercado, transporte, compras, retiros). Se
   *  informa; no resta del disponible. */
  livingCost: number;
  availableIncome: number;
  maxSuggestedInstallment: number;
  payrollLoanCapacity: number | null;
  currentDti: number | null;
  /** Cuotas mínimas en que el monto solicitado cabe en la cuota máxima. Es un
   *  CONTRASTE informativo (sin intereses): el plazo lo decide el otorgante. */
  minInstallmentsForRequested: number | null;
  paysOwnSocialSecurity: boolean;
  verifiedHireDate: string | null;
  employmentType: 'salaried' | 'independent';
}

export type PaymentCapacityScoringResult = ScoringResult & {
  capacityFigures: CapacityFigures;
};

export interface PaymentCapacityEngineInput {
  /** Pesos de las dimensiones habilitadas (config de la empresa o defaults). */
  weights: PaymentCapacityWeights;
  /** Labels del catálogo scoring_dimensions (fallback: internos del motor). */
  labels?: Partial<Record<PaymentCapacityDimension, string>>;
  request: StudyRequest;
  employmentType: 'salaried' | 'independent';
  indicators: PaymentCapacityIndicatorsResult;
  /** Riesgo de la central (MiDecisor PN, incluido en el estudio). */
  centralRisk: CentralRiskInput | null;
  /** V1–V10 de todos los documentos (intra-doc + cruzadas). */
  validationOutcomes: ValidationOutcome[];
  /** Flags de la extracción IA + las de los indicadores. */
  reliabilityFlags: ReliabilityFlag[];
  /** ¿El extracto más reciente es suficientemente fresco? null = sin dato. */
  recencyOk: boolean | null;
}

export function runPaymentCapacityScoring(
  input: PaymentCapacityEngineInput,
): PaymentCapacityScoringResult {
  const ind = input.indicators;
  const { request } = input;

  // El monto solicitado es CONTEXTO, no base del cálculo: no se pide plazo y el
  // puntaje no depende de lo que el cliente pidió. Lo único que se deriva es un
  // contraste informativo: en cuántas cuotas cabría ese monto dentro de la
  // cuota máxima sostenible (sin intereses; la tasa y el plazo los pone quien
  // presta).
  const requestedCredit = request.requestedCreditLine ?? null;
  const minInstallments =
    requestedCredit !== null &&
    requestedCredit > 0 &&
    ind.maxSuggestedInstallment > 0
      ? Math.ceil(requestedCredit / ind.maxSuggestedInstallment)
      : null;

  // Dimensiones habilitadas por la config, en orden canónico.
  const enabled = PAYMENT_CAPACITY_DIMENSIONS.filter(
    (dim) => input.weights[dim] !== undefined,
  );

  const evaluators: Record<PaymentCapacityDimension, () => RawDimension> = {
    incomeStability: () => evalIncomeStability(ind, input.recencyOk),
    indebtedness: () => evalIndebtedness(ind.currentDti),
    financialBehavior: () => evalFinancialBehavior(ind),
    docVeracity: () =>
      evalDocVeracity(input.validationOutcomes, input.reliabilityFlags),
    // Thin file: la central respondió pero SIN historia del titular. Política
    // (2026-09-05): prudencia ante lo desconocido — la dimensión queda visible
    // y en CERO, no se redistribuye. Sin consulta (null) sí se marca no
    // evaluable: esa ausencia de dato es nuestra, no del titular.
    centralRisk: () =>
      hasNoBureauHistory(input.centralRisk)
        ? {
            ratio: 0,
            status: 'no_history',
            alerts: [
              {
                type: 'warning',
                dimension: 'centralRisk',
                message:
                  'La central no tiene historia crediticia de este titular: sin puntaje, sin obligaciones reportadas y sin comportamiento de pago. Prestar a quien no ha demostrado comportamiento de pago es un riesgo en sí mismo, así que la dimensión no aporta puntos y el análisis se apoya en los documentos verificados.',
              },
            ],
          }
        : evalCentralRisk(input.centralRisk),
  };

  const raw = {} as Record<PaymentCapacityDimension, RawDimension>;
  for (const dim of enabled) {
    raw[dim] = evaluators[dim]();
  }

  // Redistribución del peso de las no evaluables (misma regla del motor EEFF).
  const effectiveWeights = redistributeWeights(enabled, input.weights, raw);

  const dimensions: Record<string, DimensionResult> = {};
  const alerts: ScoringAlert[] = [];
  let totalScore = 0;
  for (const dim of enabled) {
    const r = raw[dim];
    const weight = effectiveWeights[dim];
    const evaluable = r.ratio !== null;
    // Igual que en el motor EEFF: la contribución se redondea ANTES de sumarse,
    // para que el score sea exactamente la suma de las partes visibles.
    const contribution = evaluable ? round1(r.ratio! * weight) : 0;
    totalScore += contribution;
    dimensions[dim] = {
      // El contrato DimensionResult tipa `dimension` con los codes EEFF; aquí
      // viajan los codes de capacidad (el JSON persistido no distingue).
      dimension: dim as unknown as DimensionResult['dimension'],
      label: input.labels?.[dim] ?? LABELS[dim],
      ratio: r.ratio,
      weight,
      contribution,
      status: r.status,
      evaluable,
    };
    alerts.push(...r.alerts);
  }
  totalScore = round1(totalScore);

  // ── Monto ──
  // Creditia NO avala un cupo en este estudio: mide la capacidad y quien presta
  // decide monto, plazo y tasa. Por eso `amount` va null; se conserva la forma
  // del bloque (contrato del front y del PDF) con el solicitado y la referencia
  // de la central.
  const suggestedByBureau = input.centralRisk?.montoSugerido ?? null;
  const approvedCreditLine = {
    amount: null,
    requested: requestedCredit,
    suggestedByBureau,
    cappedByCapacity: false,
  };

  // Contraste del monto solicitado contra la cuota máxima. Es información para
  // que el otorgante decida, NO un veredicto sobre la operación.
  if (requestedCredit !== null && requestedCredit > 0) {
    alerts.unshift(
      ind.maxSuggestedInstallment > 0
        ? {
            type: 'info',
            dimension: 'general',
            message: `Cuota máxima sostenible ${money(ind.maxSuggestedInstallment)}/mes. Los ${money(requestedCredit)} solicitados requieren al menos ${minInstallments} cuota(s) de ese tamaño, sin contar intereses; el plazo y la tasa los define quien otorga el crédito.`,
          }
        : {
            type: 'danger',
            dimension: 'general',
            message: `El titular no tiene cuota mensual sostenible: los ${money(requestedCredit)} solicitados no son pagables en ningún plazo con el ingreso verificado.`,
          },
    );
  }

  // Declarar la fuente del cálculo: extractos + comprobantes verificados en
  // código (no EEFF). El índice de verificación es la medida de esa confianza.
  alerts.unshift({
    type: 'info',
    dimension: 'general',
    message:
      input.employmentType === 'salaried'
        ? `Análisis de capacidad de pago calculado sobre ${ind.coveredMonths} mes(es) de extractos bancarios y el desprendible de nómina, con validaciones documentales automáticas.`
        : `Análisis de capacidad de pago calculado sobre ${ind.coveredMonths} mes(es) de extractos bancarios del independiente, con validaciones documentales automáticas.`,
  });

  // Las cifras del estudio, al frente. Antes salían dentro de la dimensión de
  // capacidad; al no existir esa dimensión, el hallazgo principal se declara
  // como alerta propia para que no se pierda.
  if (ind.verifiedMonthlyIncome > 0) {
    alerts.unshift({
      type: ind.availableIncome > 0 ? 'success' : 'danger',
      dimension: 'general',
      message: `Capacidad verificada: ingreso ${money(ind.verifiedMonthlyIncome)}/mes, disponible ${money(ind.availableIncome)} tras compromisos fijos (${money(ind.recurringFixedExpenses)}) y obligaciones (${money(ind.existingDebtPayments)}, de los cuales ${money(ind.cardPayments)} son pago de tarjetas); cuota máxima sostenible ${money(ind.maxSuggestedInstallment)}/mes. El disponible NO descuenta el costo de vida (mercado, transporte, compras: ${money(ind.livingCost)}/mes observados); a eso responde el tope del 30% del ingreso en la cuota máxima.`,
    });
  }

  // ── Red flags de la central (misma política del motor EEFF) ──
  // Sin historia no hay red flags que levantar: "puntaje en riesgo alto" sobre
  // un score que no existe es afirmar algo que la central no dijo.
  const noBureauHistory = hasNoBureauHistory(input.centralRisk);
  const centralRiskFlags = noBureauHistory
    ? []
    : buildCentralRiskFlags(null, input.centralRisk);
  for (const f of centralRiskFlags) {
    if (f.category !== 'legal_status') {
      alerts.push({
        type: f.severity,
        dimension: 'centralRisk',
        message: `${f.title}: ${f.detail}`,
      });
    }
  }

  // ── Veredicto ──
  // Eliminatorias propias del estudio de capacidad: sin ingreso verificable, o
  // ingreso ya totalmente comprometido (disponible <= 0). Luego score 75/40 y
  // los MISMOS caps del motor EEFF (riesgo alto de la central / montoSugerido 0
  // → tope 'conditional').
  let status: 'approved' | 'conditional' | 'rejected';
  let eliminatoryReason: string | null = null;
  const bureauDeniesCredit = input.centralRisk?.montoSugerido === 0;

  if (ind.verifiedMonthlyIncome <= 0) {
    status = 'rejected';
    eliminatoryReason =
      'No se pudo verificar ningún ingreso del cliente en los documentos aportados: no hay base para un estudio de capacidad de pago.';
    alerts.unshift({
      type: 'danger',
      dimension: 'general',
      message: eliminatoryReason,
    });
  } else if (ind.availableIncome <= 0) {
    status = 'rejected';
    eliminatoryReason = `El ingreso verificado (${money(ind.verifiedMonthlyIncome)}/mes) ya está totalmente comprometido: los gastos fijos (${money(ind.recurringFixedExpenses)}) y las cuotas existentes (${money(ind.existingDebtPayments)}) no dejan ingreso disponible.`;
    alerts.unshift({
      type: 'danger',
      dimension: 'general',
      message: eliminatoryReason,
    });
  } else if (totalScore >= APPROVED_THRESHOLD) {
    status = 'approved';
  } else if (totalScore >= CONDITIONAL_THRESHOLD) {
    status = 'conditional';
  } else {
    status = 'rejected';
  }

  if (
    status === 'approved' &&
    !noBureauHistory &&
    centralMarksHighRisk(input.centralRisk)
  ) {
    status = 'conditional';
    alerts.unshift({
      type: 'warning',
      dimension: 'centralRisk',
      message:
        'La central marca a este cliente en riesgo alto. Aunque el análisis de capacidad es favorable, el veredicto se limita a "aprobado con condiciones": la información de la central prevalece.',
    });
  } else if (status === 'approved' && bureauDeniesCredit) {
    status = 'conditional';
    alerts.unshift({
      type: 'warning',
      dimension: 'centralRisk',
      message:
        'La central no avala ningún monto para este cliente (monto sugerido $0). Aunque la capacidad de pago es favorable, la aprobación final queda a criterio del analista.',
    });
  }

  // ── keyFigures (contrato del front): traducidas al mundo capacidad ──
  // monthlyPaymentCapacity = cuota máxima sugerida (lo destinable al crédito
  // nuevo). Sin plazo no existe "pago al vencimiento" ni "capacidad en el
  // plazo" (son del estudio empresarial) → 0, y el front las oculta. Las cifras
  // de ciclo operativo tampoco existen en PN.
  const keyFigures: ScoringResult['keyFigures'] = {
    monthlyPaymentCapacity: Math.round(ind.maxSuggestedInstallment),
    annualPaymentCapacity: Math.round(ind.maxSuggestedInstallment * 12),
    paymentAtMaturity: 0,
    capacityInTerm: 0,
    paymentCoverageRatio: null,
    currentDebtService: Math.round(ind.existingDebtPayments * 12),
    ebitda: 0,
    accountsReceivableTurnover: 0,
    inventoryTurnover: 0,
    paymentTimeSuppliers: 0,
    cashConversionCycle: 0,
    stabilityFactor: 0,
  };

  return {
    dimensions,
    alerts,
    reference: {
      experianScore: input.centralRisk?.score ?? null,
      experianSuggestedAmount: suggestedByBureau,
      experianRiskLevel: input.centralRisk?.nivelRiesgo ?? null,
      experianViability: input.centralRisk?.viabilidad ?? null,
      experianCollectionRating: input.centralRisk?.ratingRecaudos ?? null,
    },
    approvedCreditLine,
    keyFigures,
    summary: {
      totalScore,
      maxScore: 100,
      status,
      // Fuente del cálculo: documentos del cliente (no EEFF ni central).
      calculationSource: 'pdf',
      sourceSelection: 'auto',
      // "Verificado" en el mundo capacidad = el ingreso declarado se contrastó
      // contra la cuenta y no fue desmentido (índice >= 0.9 o independiente
      // cuyo ingreso ES el del extracto).
      financialsVerified:
        ind.incomeVerificationIndex === null ||
        ind.incomeVerificationIndex >= VERIFICATION_INDEX_FLAG,
      eliminatoryReason,
    },
    centralRiskFlags,
    // Las inyecta el servicio (extracción + validaciones fallidas).
    pdfReliabilityFlags: [],
    capacityFigures: {
      verifiedMonthlyIncome: Math.round(ind.verifiedMonthlyIncome),
      payrollNetIncome:
        ind.payrollNetIncome !== null ? Math.round(ind.payrollNetIncome) : null,
      bankStatementIncome: Math.round(ind.bankStatementIncome),
      incomeVerificationIndex:
        ind.incomeVerificationIndex !== null
          ? round2(ind.incomeVerificationIndex)
          : null,
      incomeCv: ind.incomeCv !== null ? round2(ind.incomeCv) : null,
      monthsWithIncome: ind.monthsWithIncome,
      coveredMonths: ind.coveredMonths,
      windowMonths: ind.windowMonths,
      recurringFixedExpenses: Math.round(ind.recurringFixedExpenses),
      existingDebtPayments: Math.round(ind.existingDebtPayments),
      debtServicePayments: Math.round(ind.debtServicePayments),
      centralMonthlyQuota:
        ind.centralMonthlyQuota !== null
          ? Math.round(ind.centralMonthlyQuota)
          : null,
      cardPayments: Math.round(ind.cardPayments),
      livingCost: Math.round(ind.livingCost),
      availableIncome: Math.round(ind.availableIncome),
      maxSuggestedInstallment: Math.round(ind.maxSuggestedInstallment),
      payrollLoanCapacity:
        ind.payrollLoanCapacity !== null
          ? Math.round(ind.payrollLoanCapacity)
          : null,
      currentDti: ind.currentDti !== null ? round2(ind.currentDti) : null,
      minInstallmentsForRequested: minInstallments,
      paysOwnSocialSecurity: ind.paysOwnSocialSecurity,
      verifiedHireDate: ind.verifiedHireDate,
      employmentType: input.employmentType,
    },
  };
}

// ─── Dim: Estabilidad del ingreso ──────────────────────────────────────────
// Compuesta: varianza del ingreso (CV) 50%, meses con ingreso 30%, antigüedad
// laboral 20%. La PILA propia del independiente suma un bono (formalidad).
function evalIncomeStability(
  ind: PaymentCapacityIndicatorsResult,
  recencyOk: boolean | null,
): RawDimension {
  if (ind.coveredMonths === 0 || ind.verifiedMonthlyIncome <= 0) {
    return { ratio: null, status: 'not_evaluable', alerts: [] };
  }

  const cv = ind.incomeCv;
  const cvScore =
    cv === null ? 0.5 : cv <= 0.15 ? 1 : cv <= 0.35 ? 0.6 : cv <= 0.6 ? 0.3 : 0;
  const monthsScore = ind.monthsWithIncome / ind.coveredMonths;

  let seniorityScore = 0.5; // sin dato: neutral
  if (ind.verifiedHireDate) {
    const monthsEmployed =
      (Date.now() - Date.parse(ind.verifiedHireDate)) / (30 * 86_400_000);
    seniorityScore =
      monthsEmployed >= 24
        ? 1
        : monthsEmployed >= 12
          ? 0.8
          : monthsEmployed >= 6
            ? 0.5
            : 0.2;
  }

  let ratio = cvScore * 0.5 + monthsScore * 0.3 + seniorityScore * 0.2;
  if (ind.paysOwnSocialSecurity) ratio = Math.min(ratio + 0.05, 1);
  ratio = round2(clamp(ratio, 0, 1));

  const alerts: ScoringAlert[] = [];
  const cvPct = cv !== null ? `${Math.round(cv * 100)}%` : 'sin dato';
  if (ratio >= 0.7) {
    alerts.push({
      type: 'success',
      dimension: 'incomeStability',
      message: `Ingreso estable: ${ind.monthsWithIncome}/${ind.coveredMonths} meses con ingreso y variación del ${cvPct}.`,
    });
  } else if (ratio >= 0.4) {
    alerts.push({
      type: 'warning',
      dimension: 'incomeStability',
      message: `Ingreso con volatilidad moderada: ${ind.monthsWithIncome}/${ind.coveredMonths} meses con ingreso y variación del ${cvPct}.`,
    });
  } else {
    alerts.push({
      type: 'danger',
      dimension: 'incomeStability',
      message: `Ingreso volátil: ${ind.monthsWithIncome}/${ind.coveredMonths} meses con ingreso y variación del ${cvPct}. Un mes sin ingreso compromete la cuota.`,
    });
  }
  if (recencyOk === false) {
    alerts.push({
      type: 'warning',
      dimension: 'incomeStability',
      message:
        'El extracto más reciente tiene un corte antiguo: la foto del ingreso puede no reflejar la situación actual.',
    });
  }
  const status =
    ratio >= 0.7 ? 'stable' : ratio >= 0.4 ? 'moderate' : 'volatile';
  return { ratio, status, alerts };
}

// ─── Dim: Endeudamiento (DTI) ──────────────────────────────────────────────
// Juzga el DTI ACTUAL: cuotas que YA paga ÷ ingreso verificado. Antes mandaba
// un DTI "proyectado" que se construía con una cuota implícita derivada del
// plazo solicitado; sin plazo esa proyección no existe — y era arbitraria, no
// medía a la persona. Umbrales §4.3: <30% sano, 30–45% justo, >45% crítico.
function evalIndebtedness(currentDti: number | null): RawDimension {
  const dti = currentDti;
  if (dti === null) {
    return { ratio: null, status: 'not_evaluable', alerts: [] };
  }
  const label = 'DTI actual';
  const currentNote = '';
  if (dti < DTI_HEALTHY) {
    return {
      ratio: 1,
      status: 'healthy',
      alerts: [
        {
          type: 'success',
          dimension: 'indebtedness',
          message: `${label} del ${pct(dti)}${currentNote}: endeudamiento sano (< ${pct(DTI_HEALTHY)}).`,
        },
      ],
    };
  }
  if (dti <= DTI_CRITICAL) {
    return {
      ratio: 0.5,
      status: 'fair',
      alerts: [
        {
          type: 'warning',
          dimension: 'indebtedness',
          message: `${label} del ${pct(dti)}${currentNote}: endeudamiento justo (entre ${pct(DTI_HEALTHY)} y ${pct(DTI_CRITICAL)}).`,
        },
      ],
    };
  }
  return {
    ratio: 0,
    status: 'critical',
    alerts: [
      {
        type: 'danger',
        dimension: 'indebtedness',
        message: `${label} del ${pct(dti)}${currentNote}: endeudamiento crítico (> ${pct(DTI_CRITICAL)}). Las cuotas se comen el ingreso.`,
      },
    ],
  };
}

// ─── Dim: Comportamiento financiero ────────────────────────────────────────
// Arranca en 1.0 y descuenta por señales del extracto (§4.4): días en negativo,
// retiro inmediato del ingreso, apuestas, avances de TC y colchón bajo.
function evalFinancialBehavior(
  ind: PaymentCapacityIndicatorsResult,
): RawDimension {
  const b = ind.behavior;
  let ratio = 1;
  const notes: string[] = [];

  if (b.daysNegative > 10) {
    ratio -= 0.4;
    notes.push(`${b.daysNegative} días con saldo en negativo`);
  } else if (b.daysNegative > 0) {
    ratio -= 0.2;
    notes.push(`${b.daysNegative} días con saldo en negativo`);
  }
  if (b.pctWithdrawn48h !== null && b.pctWithdrawn48h > 0.8) {
    ratio -= 0.2;
    notes.push(
      `el ${pct(b.pctWithdrawn48h)} del ingreso se retira en las 48h siguientes al abono`,
    );
  } else if (b.pctWithdrawn48h !== null && b.pctWithdrawn48h > 0.5) {
    ratio -= 0.1;
    notes.push(
      `el ${pct(b.pctWithdrawn48h)} del ingreso se retira en las 48h siguientes al abono`,
    );
  }
  if (b.gamblingPctOfIncome !== null && b.gamblingPctOfIncome > 0.15) {
    ratio -= 0.5;
    notes.push(`apuestas por el ${pct(b.gamblingPctOfIncome)} del ingreso`);
  } else if (b.gamblingPctOfIncome !== null && b.gamblingPctOfIncome > 0.05) {
    ratio -= 0.2;
    notes.push(`apuestas por el ${pct(b.gamblingPctOfIncome)} del ingreso`);
  }
  if (b.cardCashInTotal > 0) {
    ratio -= 0.15;
    notes.push(`avances de TC hacia la cuenta (${money(b.cardCashInTotal)})`);
  }
  if (
    b.averageBalance !== null &&
    ind.verifiedMonthlyIncome > 0 &&
    b.averageBalance / ind.verifiedMonthlyIncome < 0.15
  ) {
    ratio -= 0.15;
    notes.push(
      `saldo promedio (${money(b.averageBalance)}) muy bajo frente al ingreso: colchón mínimo`,
    );
  }

  ratio = round2(clamp(ratio, 0, 1));
  const status = ratio >= 0.7 ? 'healthy' : ratio >= 0.4 ? 'watch' : 'risky';
  // Con señales descontadas la alerta nunca es "success": lo que describe
  // son cautelas, aunque el conjunto siga sano.
  const type =
    notes.length === 0
      ? 'success'
      : ratio >= 0.7
        ? 'info'
        : ratio >= 0.4
          ? 'warning'
          : 'danger';
  return {
    ratio,
    status,
    alerts: [
      {
        type,
        dimension: 'financialBehavior',
        message:
          notes.length === 0
            ? 'Manejo sano de la cuenta: sin días en negativo ni señales de estrés de liquidez.'
            : `Señales a vigilar en el manejo de la cuenta: ${notes.join('; ')}.`,
      },
    ],
  };
}

// ─── Dim: Veracidad documental ─────────────────────────────────────────────
// Arranca en 1.0 y descuenta por validaciones V1–V10 FALLIDAS (danger pesa
// fuerte: saldo que no cuadra o cuenta ajena es señal de adulteración) y por
// flags de la extracción. Las no-evaluables (passed null) no penalizan.
function evalDocVeracity(
  outcomes: ValidationOutcome[],
  flags: ReliabilityFlag[],
): RawDimension {
  if (outcomes.length === 0) {
    return { ratio: null, status: 'not_evaluable', alerts: [] };
  }
  let ratio = 1;
  const failed = outcomes.filter((o) => o.passed === false);
  const notes: string[] = [];
  for (const o of failed) {
    ratio -= o.severity === 'danger' ? 0.35 : 0.15;
    notes.push(`${o.code} ${o.label}`);
  }
  const dangerFlags = flags.filter((f) => f.severity === 'danger').length;
  const warningFlags = flags.filter((f) => f.severity === 'warning').length;
  ratio -= dangerFlags * 0.15 + warningFlags * 0.05;
  ratio = round2(clamp(ratio, 0, 1));

  const passedCount = outcomes.filter((o) => o.passed === true).length;
  const status =
    ratio >= 0.8 ? 'consistent' : ratio >= 0.4 ? 'discrepant' : 'suspect';
  const type = ratio >= 0.8 ? 'success' : ratio >= 0.4 ? 'warning' : 'danger';
  return {
    ratio,
    status,
    alerts: [
      {
        type,
        dimension: 'docVeracity',
        message:
          failed.length === 0
            ? `Documentos consistentes: ${passedCount} validación(es) automática(s) superada(s) y sin señales de adulteración.`
            : `Validaciones documentales FALLIDAS: ${notes.join('; ')}. Posible documento alterado o extracción incompleta — revisar antes de decidir.`,
      },
    ],
  };
}

// ─── Redistribución de pesos (misma regla del motor EEFF) ──────────────────
function redistributeWeights(
  enabled: PaymentCapacityDimension[],
  weights: PaymentCapacityWeights,
  raw: Record<PaymentCapacityDimension, RawDimension>,
): Record<PaymentCapacityDimension, number> {
  const evaluables = enabled.filter((d) => raw[d].ratio !== null);
  const missingWeight = enabled
    .filter((d) => raw[d].ratio === null)
    .reduce((sum, d) => sum + weights[d]!, 0);
  const evaluableWeightSum = evaluables.reduce(
    (sum, d) => sum + weights[d]!,
    0,
  );
  const result = {} as Record<PaymentCapacityDimension, number>;
  for (const dim of enabled) {
    if (raw[dim].ratio === null) {
      result[dim] = 0;
    } else if (evaluableWeightSum > 0) {
      result[dim] =
        weights[dim]! + missingWeight * (weights[dim]! / evaluableWeightSum);
    } else {
      result[dim] = weights[dim]!;
    }
  }
  return result;
}

// Helpers numéricos/formato: ../../common/utils/format.utils.js
