import {
  SCORING_DIMENSIONS,
  scoreToBand,
  SUGGESTED_AMOUNT_ALERT_WARNING,
  SUGGESTED_AMOUNT_ALERT_DANGER,
  REGISTRATION_CANCELLED_VALUES,
  IN_LIQUIDATION_VALUES,
  ARREARS_SEVERITY,
  ARREARS_RECENT_WINDOW,
  ARREARS_MAX_PENALTY,
  ARREARS_FLAG_DANGER,
  ARREARS_FLAG_WARNING,
  DEBT_RATIO_DANGER,
  DEBT_RATIO_WARNING,
  CENTRAL_SCORE_CONDITIONAL_CAP,
  CENTRAL_MAX_RISK_LEVELS,
  CENTRAL_RISK_FLAG_CATEGORY_LABEL,
  type ScoringDimension,
} from './scoring.constants.js';
import type {
  ScoringEngineInput,
  ScoringResult,
  DimensionResult,
  ScoringAlert,
  GrossFigures,
  CentralRiskInput,
  ScoringIndicators,
  StudyRequest,
  LegalStatusInput,
  CentralRiskFlag,
  PaymentBehaviorMonth,
} from './scoring.types.js';

// ─── MOTOR DE SCORING v2 (función pura) ─────────────────────────────────────
// Evalúa las dimensiones HABILITADAS por la config de la empresa sobre la
// fuente de verdad (DataCrédito), pondera con los pesos configurados
// (redistribuyendo el peso de las que no se pueden evaluar) y produce el
// veredicto. Una dimensión deshabilitada (sin peso en la entrada) no se evalúa
// ni aparece en el resultado. NO lee BD: el servicio arma la entrada.
//
// Umbrales de veredicto FIJOS (no configurables): >=75 approved, >=40 conditional.
// Las reglas ELIMINATORIAS (estado legal, capacidad de pago <= 0) y los caps de
// veredicto (riesgo alto de la central, montoSugerido=0 → tope 'conditional')
// son POLÍTICA de Creditia: aplican SIEMPRE, sin importar qué dimensiones haya
// habilitado la empresa. El montoSugerido de la central NO es techo del monto:
// el monto lo mandan los EEFF; la central aporta señal (alertas/cap).

const APPROVED_THRESHOLD = 75;
const CONDITIONAL_THRESHOLD = 40;

// Contraste de veracidad (Dim 6): diferencia relativa que dispara cada nivel.
const VERACITY_WARNING = 0.1; // 10%
const VERACITY_DANGER = 0.25; // 25%

const LABELS: Record<ScoringDimension, string> = {
  financialHealth: 'Salud financiera',
  paymentCapacity: 'Capacidad de pago', // integra la adecuación del cupo
  termCoherence: 'Coherencia de plazos',
  capitalExposure: 'Exposición del capital',
  veracity: 'Veracidad',
  centralRisk: 'Riesgo de la central',
};

/** Resultado bruto de una dimensión antes de ponderar. */
interface RawDimension {
  ratio: number | null; // null = no evaluable
  status: string;
  alerts: ScoringAlert[];
}

export function runScoring(input: ScoringEngineInput): ScoringResult {
  const { indicators, request } = input;
  const source = input.truthFigures
    ? 'datacredito'
    : input.pdfFigures
      ? 'pdf'
      : 'none';

  // Monto sugerido por la central: REFERENCIA (señal de alerta), no techo. El
  // monto lo mandan los EEFF. null si no hubo consulta (o no vino).
  const suggestedByBureau = input.centralRisk?.montoSugerido ?? null;
  const requestedCredit = request.requestedCreditLine ?? null;

  // Dimensiones HABILITADAS por la config (las que traen peso), en orden
  // canónico. Solo estas se evalúan; las demás no participan del estudio.
  const enabled = SCORING_DIMENSIONS.filter(
    (dim) => input.weights[dim] !== undefined,
  );

  // Evaluadores por dimensión (perezosos: solo corre el de las habilitadas).
  const evaluators: Record<ScoringDimension, () => RawDimension> = {
    financialHealth: () => evalFinancialHealth(indicators),
    paymentCapacity: () =>
      evalPaymentCapacity(indicators, request, suggestedByBureau),
    termCoherence: () => evalTermCoherence(indicators, request),
    capitalExposure: () => evalCapitalExposure(indicators, request),
    veracity: () =>
      evalVeracity(input.truthFigures, input.pdfFigures, input.personType),
    centralRisk: () => evalCentralRisk(input.centralRisk),
  };

  // Evaluar cada dimensión habilitada → resultado bruto (ratio 0..1 | null).
  const raw = {} as Record<ScoringDimension, RawDimension>;
  for (const dim of enabled) {
    raw[dim] = evaluators[dim]();
  }

  // Redistribuir pesos de las dimensiones NO evaluables entre las evaluables.
  const effectiveWeights = redistributeWeights(enabled, input.weights, raw);

  // Armar el resultado por dimensión + contribución.
  const dimensions: Record<string, DimensionResult> = {};
  const alerts: ScoringAlert[] = [];
  let totalScore = 0;

  for (const dim of enabled) {
    const r = raw[dim];
    const weight = effectiveWeights[dim];
    const evaluable = r.ratio !== null;
    const contribution = evaluable ? r.ratio! * weight : 0;
    totalScore += contribution;
    dimensions[dim] = {
      dimension: dim,
      // Label del catálogo (BD) si vino; si no, el interno del motor.
      label: input.labels?.[dim] ?? LABELS[dim],
      ratio: r.ratio,
      weight,
      contribution: round2(contribution),
      status: r.status,
      evaluable,
    };
    alerts.push(...r.alerts);
  }

  totalScore = Math.round(totalScore);

  // ── Salvedad de la fuente de cálculo (para que el cliente decida) ──
  // El análisis debe declarar EXPLÍCITAMENTE con qué cifras se calculó, porque no
  // todas son igual de confiables: DataCrédito es oficial; el PDF es auto-
  // reportado por el cliente y puede no estar verificado contra la central.
  if (source === 'pdf') {
    alerts.unshift({
      type: 'warning',
      dimension: 'general',
      message:
        'Análisis calculado con estados financieros auto-reportados (PDF). La central no tiene información financiera de esta empresa, por lo que las cifras NO pudieron verificarse. Decida con cautela.',
    });
  } else if (source === 'datacredito' && !input.pdfFigures) {
    // Corrió sobre la fuente de verdad, pero sin PDF no hubo contraste de
    // veracidad. Se informa como dato (no como advertencia de riesgo).
    alerts.unshift({
      type: 'info',
      dimension: 'general',
      message:
        'Análisis calculado con los estados financieros reportados en la central (DataCrédito). No se cargó un PDF, por lo que no se realizó contraste de veracidad.',
    });
  }

  // ── Monto aprobado por Creditia ──
  // Lo mandan los EEFF: el solicitado si cabe en el máximo pagable según la
  // capacidad de pago para el plazo pedido; si pide de más, se recorta a ese
  // máximo. El montoSugerido de la central NO recorta (es referencia/alerta).
  const approvedCreditLine = resolveApprovedCredit(
    requestedCredit,
    indicators,
    request,
    suggestedByBureau,
  );
  if (approvedCreditLine.cappedByCapacity) {
    alerts.unshift({
      type: 'warning',
      dimension: 'paymentCapacity',
      message: `El cupo solicitado (${money(approvedCreditLine.requested ?? 0)}) supera el máximo pagable según los estados financieros para el plazo pedido. Creditia avala hasta ${money(approvedCreditLine.amount ?? 0)}.`,
    });
  }

  // ── Red flags derivadas de la central (estado legal, mora, endeudamiento…) ──
  const centralRiskFlags = buildCentralRiskFlags(
    input.legalStatus,
    input.centralRisk,
  );
  // Las flags de mora/endeudamiento también se reflejan como alertas del sistema.
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
  // Reglas ELIMINATORIAS (rechazo directo, sin importar el score), en orden:
  //  1. Estado legal: matrícula cancelada o empresa en liquidación.
  //  2. Capacidad de pago mensual <= 0.
  // Si ninguna aplica, el veredicto sale del score, pero con CAPs a 'conditional'
  // (nunca 'approved' automático) por señales fuertes de la central: banda de
  // riesgo alto (§ CENTRAL_SCORE_CONDITIONAL_CAP) o montoSugerido = 0 (la
  // central no lo reconoce como sujeto de crédito). En ambos, el analista decide
  // con los EEFF a la vista; la central no veta si las cifras lo respaldan.
  let status: 'approved' | 'conditional' | 'rejected';
  let eliminatoryReason: string | null = null;
  const legalReason = eliminatoryLegalReason(input.legalStatus);
  const bureauDeniesCredit = input.centralRisk?.montoSugerido === 0;

  if (legalReason) {
    status = 'rejected';
    eliminatoryReason = legalReason;
    alerts.unshift({
      type: 'danger',
      dimension: 'general',
      message: legalReason,
    });
  } else if (indicators.monthlyPaymentCapacity <= 0) {
    status = 'rejected';
    eliminatoryReason =
      'El cliente no cuenta con capacidad de pago: el servicio de deuda supera el EBITDA ajustado.';
  } else if (totalScore >= APPROVED_THRESHOLD) {
    status = 'approved';
  } else if (totalScore >= CONDITIONAL_THRESHOLD) {
    status = 'conditional';
  } else {
    status = 'rejected';
  }

  // Caps a 'conditional' por señales fuertes de la central (no fuerzan rechazo;
  // no aplican si ya hubo motivo eliminatorio, pues el estado ya es 'rejected'):
  //  a. Banda de riesgo alto (score bajo o nivel MÁXIMO/ALTO): un PDF auto-
  //     reportado no puede "aprobar" a quien la central marca en riesgo alto.
  //  b. montoSugerido = 0: la central no lo reconoce como sujeto de crédito;
  //     los EEFF pueden sostener la operación, pero la aprobación queda en
  //     manos del analista (nunca 'approved' automático).
  if (status === 'approved' && centralMarksHighRisk(input.centralRisk)) {
    status = 'conditional';
    alerts.unshift({
      type: 'warning',
      dimension: 'centralRisk',
      message:
        'La central marca a este cliente en riesgo alto. Aunque el análisis financiero es favorable, el veredicto se limita a "aprobado con condiciones": la información de la central prevalece sobre las cifras auto-reportadas.',
    });
  } else if (status === 'approved' && bureauDeniesCredit) {
    status = 'conditional';
    alerts.unshift({
      type: 'warning',
      dimension: 'centralRisk',
      message:
        'La central no avala ningún monto para este cliente (monto sugerido $0). Aunque los estados financieros son favorables, el veredicto se limita a "aprobado con condiciones": la aprobación final queda a criterio del analista.',
    });
  }

  // ── Cifras clave (para mostrar en el front, no solo en el texto) ──
  const estimatedMonthlyQuota = monthlyQuota(request);
  const cashConversionCycle =
    indicators.accountsReceivableTurnover +
    indicators.inventoryTurnover -
    Math.max(indicators.paymentTimeSuppliers, 0);
  const keyFigures = {
    monthlyPaymentCapacity: indicators.monthlyPaymentCapacity,
    annualPaymentCapacity: indicators.annualPaymentCapacity,
    estimatedMonthlyQuota: Math.round(estimatedMonthlyQuota),
    paymentCoverageRatio:
      estimatedMonthlyQuota > 0
        ? round2(indicators.monthlyPaymentCapacity / estimatedMonthlyQuota)
        : null,
    currentDebtService: indicators.currentDebtService,
    ebitda: indicators.ebitda,
    accountsReceivableTurnover: indicators.accountsReceivableTurnover,
    inventoryTurnover: indicators.inventoryTurnover,
    paymentTimeSuppliers: indicators.paymentTimeSuppliers,
    cashConversionCycle: Math.round(cashConversionCycle),
    stabilityFactor: indicators.stabilityFactor,
  };

  return {
    dimensions,
    alerts,
    reference: {
      experianScore: input.centralRisk?.score ?? null,
      experianSuggestedAmount: input.centralRisk?.montoSugerido ?? null,
      experianRiskLevel: input.centralRisk?.nivelRiesgo ?? null,
    },
    approvedCreditLine,
    keyFigures,
    summary: {
      totalScore,
      maxScore: 100,
      status,
      calculationSource: source,
      // Verificado solo si corrió sobre la fuente de verdad Y hubo contraste.
      financialsVerified: source === 'datacredito' && input.pdfFigures !== null,
      eliminatoryReason,
    },
    centralRiskFlags,
    // Las flags de fiabilidad del PDF NO las conoce el motor (viven en el
    // análisis PDF). El servicio las inyecta tras runScoring. Se inicializa vacío.
    pdfReliabilityFlags: [],
  };
}

// ─── Dimensiones 1-5 (lógica del modelo existente) ──────────────────────────

// Dim 1: Salud financiera (Z-Altman → stabilityFactor).
function evalFinancialHealth(ind: ScoringIndicators): RawDimension {
  if (ind.stabilityFactor >= 1) {
    return {
      ratio: 1,
      status: 'healthy',
      alerts: [
        {
          type: 'success',
          dimension: 'financialHealth',
          message:
            'La empresa presenta indicadores financieros sólidos con baja probabilidad de riesgo.',
        },
      ],
    };
  }
  if (ind.stabilityFactor >= 0.66) {
    return {
      ratio: 0.5,
      status: 'gray_zone',
      alerts: [
        {
          type: 'warning',
          dimension: 'financialHealth',
          message:
            'La empresa se encuentra en zona de observación. Se recomienda monitoreo periódico.',
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
        dimension: 'financialHealth',
        message:
          'La empresa presenta indicadores financieros críticos con alta probabilidad de incumplimiento.',
      },
    ],
  };
}

// Dim 2: Capacidad de pago y adecuación del cupo (fusiona la antigua Dim 4).
// El score sale de cuánto cubre la capacidad de pago mensual la cuota estimada
// (la cuota integra cupo Y plazo, así que también juzga el tamaño del cupo).
// Los mensajes explicitan el máximo pagable en el plazo (la vista "cupo") y, si
// hay consulta a la central, se CONTRASTA el pedido contra el montoSugerido:
// solo como ALERTA informativa (1.5× warning / 3× danger), sin tocar el score.
// El montoSugerido del mercado suele ser conservador frente a los EEFF reales
// del cliente; el analista pondera la señal, la central no veta.
function evalPaymentCapacity(
  ind: ScoringIndicators,
  req: StudyRequest,
  suggestedByBureau: number | null,
): RawDimension {
  if (ind.monthlyPaymentCapacity <= 0) {
    return {
      ratio: 0,
      status: 'insufficient',
      alerts: [
        {
          type: 'danger',
          dimension: 'paymentCapacity',
          message: `El cliente no cuenta con capacidad de pago: el servicio de deuda actual (${money(ind.currentDebtService)}) supera el EBITDA ajustado.`,
        },
      ],
    };
  }
  const requestedCredit = req.requestedCreditLine ?? 0;
  const requestedTerm = req.requestedTerm ?? 0;
  const monthlyObligation = monthlyQuota(req);
  const ratio =
    monthlyObligation > 0 ? ind.monthlyPaymentCapacity / monthlyObligation : 0;
  // Máximo pagable en el plazo pedido: la vista "cupo" de la misma medida.
  const maxCreditForTerm = maxPayableForTerm(ind, req);

  // Señal de la central: pedir MUY por encima del montoSugerido genera alerta
  // informativa (no puntúa). null o 0 no alertan aquí: 0 tiene su red flag y su
  // cap de veredicto propios.
  const bureauAlerts: ScoringAlert[] = [];
  if (suggestedByBureau !== null && suggestedByBureau > 0) {
    const multiple = requestedCredit / suggestedByBureau;
    if (multiple > SUGGESTED_AMOUNT_ALERT_DANGER) {
      bureauAlerts.push({
        type: 'danger',
        dimension: 'paymentCapacity',
        message: `El cupo solicitado (${money(requestedCredit)}) es más de ${SUGGESTED_AMOUNT_ALERT_DANGER} veces el monto sugerido por la central (${money(suggestedByBureau)}). La central no recorta el monto, pero la brecha es muy amplia: valide con especial cuidado.`,
      });
    } else if (multiple > SUGGESTED_AMOUNT_ALERT_WARNING) {
      bureauAlerts.push({
        type: 'warning',
        dimension: 'paymentCapacity',
        message: `El cupo solicitado (${money(requestedCredit)}) supera en más de ${SUGGESTED_AMOUNT_ALERT_WARNING} veces el monto sugerido por la central (${money(suggestedByBureau)}). Señal informativa: el monto avalado se basa en los estados financieros.`,
      });
    }
  }

  if (ratio >= 1.2) {
    return {
      ratio: 1,
      status: 'comfortable',
      alerts: [
        {
          type: 'success',
          dimension: 'paymentCapacity',
          message: `La capacidad de pago mensual (${money(ind.monthlyPaymentCapacity)}) supera la cuota estimada (${money(monthlyObligation)}) con holgura. El cupo solicitado (${money(requestedCredit)}) cabe en el máximo pagable a ${requestedTerm} días (${money(maxCreditForTerm)}).`,
        },
        ...bureauAlerts,
      ],
    };
  }
  if (ratio >= 1.0) {
    return {
      ratio: 0.6,
      status: 'tight',
      alerts: [
        {
          type: 'warning',
          dimension: 'paymentCapacity',
          message: `La capacidad de pago mensual (${money(ind.monthlyPaymentCapacity)}) cubre la cuota (${money(monthlyObligation)}) con margen ajustado: el cupo solicitado (${money(requestedCredit)}) está al límite del máximo pagable a ${requestedTerm} días (${money(maxCreditForTerm)}).`,
        },
        ...bureauAlerts,
      ],
    };
  }
  return {
    ratio: 0,
    status: 'insufficient',
    alerts: [
      {
        type: 'danger',
        dimension: 'paymentCapacity',
        message: `La capacidad de pago mensual (${money(ind.monthlyPaymentCapacity)}) es insuficiente para la cuota estimada (${money(monthlyObligation)}): el cupo solicitado (${money(requestedCredit)}) excede el máximo pagable a ${requestedTerm} días (${money(maxCreditForTerm)}).`,
      },
      ...bureauAlerts,
    ],
  };
}

// Dim 3: Coherencia de plazos. Compara el plazo que el cliente pide para pagarle
// a Creditia (requestedTerm) contra su rotación de cartera (lo que tarda en
// cobrarle a SUS clientes). La lectura es desde la CAJA DEL CLIENTE:
//  - plazo >= rotación: el cliente cobra ANTES de tener que pagarnos → cómodo,
//    su caja soporta el crédito sin tensión.
//  - plazo < rotación: el cliente debe pagarnos ANTES de cobrar → tensión de
//    liquidez para él (debe financiar la brecha con su propio capital). No es
//    "riesgo de incumplimiento" directo: para Creditia cobrar rápido es más
//    seguro. Pero una brecha grande estresa la caja del cliente y puede derivar
//    en pago tardío si no tiene colchón, por eso se penaliza de forma moderada.
function evalTermCoherence(
  ind: ScoringIndicators,
  req: StudyRequest,
): RawDimension {
  const requestedTerm = req.requestedTerm ?? 0;
  const collectionDays =
    ind.accountsReceivableTurnover > 0
      ? ind.accountsReceivableTurnover
      : requestedTerm;
  // Plazo cómodo: cobra a sus clientes antes (o justo) de pagarnos.
  if (requestedTerm >= collectionDays) {
    return {
      ratio: 1,
      status: 'comfortable',
      alerts: [
        {
          type: 'success',
          dimension: 'termCoherence',
          message: `El plazo solicitado (${requestedTerm}d) le da margen: el cliente cobra a sus clientes en ${collectionDays}d, antes de tener que pagar. Su caja soporta el crédito sin tensión.`,
        },
      ],
    };
  }
  // Plazo ajustado: paga antes de cobrar, pero la brecha es manejable.
  if (requestedTerm >= collectionDays * 0.7) {
    return {
      ratio: 0.5,
      status: 'tight',
      alerts: [
        {
          type: 'warning',
          dimension: 'termCoherence',
          message: `El plazo solicitado (${requestedTerm}d) es menor que la rotación de cartera (${collectionDays}d): el cliente debe pagarnos antes de cobrar a sus clientes. Tensión de caja moderada; deberá cubrir la brecha con su propio capital de trabajo.`,
        },
      ],
    };
  }
  // Plazo muy corto frente a una cobranza lenta: tensión de caja fuerte.
  return {
    ratio: 0,
    status: 'strained',
    alerts: [
      {
        type: 'warning',
        dimension: 'termCoherence',
        message: `El plazo solicitado (${requestedTerm}d) es muy inferior a la rotación de cartera (${collectionDays}d): el cliente tendría que pagarnos mucho antes de cobrar. Alta tensión de liquidez; requiere un capital de trabajo holgado para no atrasarse.`,
      },
    ],
  };
}

// Dim 5: Exposición / eficiencia del capital (interés del prestamista).
function evalCapitalExposure(
  ind: ScoringIndicators,
  req: StudyRequest,
): RawDimension {
  if (ind.monthlyPaymentCapacity <= 0) {
    return { ratio: 0, status: 'not_applicable', alerts: [] };
  }
  const requestedCredit = req.requestedCreditLine ?? 0;
  const supplierDays = Math.max(ind.paymentTimeSuppliers, 0);
  const ccc =
    ind.accountsReceivableTurnover + ind.inventoryTurnover - supplierDays;
  const cicloRef = Math.max(ccc, 30);
  const healthyExposure = ind.monthlyPaymentCapacity * (cicloRef / 30);
  const ratio = healthyExposure > 0 ? requestedCredit / healthyExposure : 0;
  if (ratio <= 1.0) {
    return {
      ratio: 1,
      status: 'efficient',
      alerts: [
        {
          type: 'success',
          dimension: 'capitalExposure',
          message:
            'El crédito respeta el ciclo de caja del cliente; el capital rota de forma eficiente.',
        },
      ],
    };
  }
  if (ratio <= 1.5) {
    return {
      ratio: 0.6,
      status: 'acceptable',
      alerts: [
        {
          type: 'warning',
          dimension: 'capitalExposure',
          message:
            'El crédito supera levemente el ciclo de caja del cliente; exposición algo mayor a lo ideal.',
        },
      ],
    };
  }
  return {
    ratio: 0,
    status: 'excessive',
    alerts: [
      {
        type: 'danger',
        dimension: 'capitalExposure',
        message:
          'El crédito inmoviliza capital muy por encima del ciclo de caja del cliente; exposición excesiva.',
      },
    ],
  };
}

// ─── Dim 6: Veracidad (contraste PDF ↔ DataCrédito, mismo año) ──────────────
// El trato cuando falta una fuente depende del tipo de persona:
//  - PJ: la empresa ESTÁ OBLIGADA a reportar EEFF a la central. Si no hay con qué
//    contrastar (p. ej. no hay EEFF en DataCrédito), NO podemos verificar que
//    digan la verdad → la veracidad puntúa 0 (no se exime). Distinto de un
//    maquillaje detectado, pero igual de penalizado: no hay respaldo.
//  - PN: la central NO reporta EEFF de PN, así que nunca hay contraste posible →
//    la dimensión no aplica (ratio null) y su peso se redistribuye.
function evalVeracity(
  truth: GrossFigures | null,
  pdf: GrossFigures | null,
  personType: 'legalEntity' | 'naturalPerson',
): RawDimension {
  // Sin las dos fuentes no hay contraste posible.
  if (!truth || !pdf) {
    // PN: no aplica → se redistribuye.
    if (personType === 'naturalPerson') {
      return { ratio: null, status: 'not_evaluable', alerts: [] };
    }
    // PJ: no se pudo verificar → penaliza (ratio 0). Se distingue el motivo:
    // falta el reporte en la central (lo esperable) o falta el PDF.
    const message = !truth
      ? 'No fue posible verificar la veracidad: la central (DataCrédito) no tiene estados financieros de esta empresa para contrastar contra el PDF. Al estar la persona jurídica obligada a reportar, la ausencia de respaldo penaliza esta dimensión.'
      : 'No fue posible verificar la veracidad: no se cargó el PDF de estados financieros para contrastar contra la central.';
    return {
      ratio: 0,
      status: 'unverifiable',
      alerts: [{ type: 'danger', dimension: 'veracity', message }],
    };
  }
  const fields: Array<{ key: keyof GrossFigures; label: string }> = [
    { key: 'ordinaryActivityRevenue', label: 'ingresos' },
    { key: 'totalAssets', label: 'activo total' },
    { key: 'totalLiabilities', label: 'pasivo total' },
    { key: 'equity', label: 'patrimonio' },
    { key: 'netIncome', label: 'utilidad neta' },
  ];
  let worstDiff = 0;
  let worstLabel = '';
  for (const f of fields) {
    const t = truth[f.key];
    const p = pdf[f.key];
    if (t === null || p === null || t === 0) continue; // sin base comparable
    const diff = Math.abs(p - t) / Math.abs(t);
    if (diff > worstDiff) {
      worstDiff = diff;
      worstLabel = f.label;
    }
  }
  if (worstDiff > VERACITY_DANGER) {
    return {
      ratio: 0,
      status: 'manipulated',
      alerts: [
        {
          type: 'danger',
          dimension: 'veracity',
          message: `Las cifras del PDF difieren en ${pct(worstDiff)} de la central en "${worstLabel}". Posible maquillaje de los estados financieros.`,
        },
      ],
    };
  }
  if (worstDiff > VERACITY_WARNING) {
    return {
      ratio: 0.5,
      status: 'discrepant',
      alerts: [
        {
          type: 'warning',
          dimension: 'veracity',
          message: `Las cifras del PDF difieren en ${pct(worstDiff)} de la central en "${worstLabel}". Revisar la consistencia de la información.`,
        },
      ],
    };
  }
  return {
    ratio: 1,
    status: 'consistent',
    alerts: [
      {
        type: 'success',
        dimension: 'veracity',
        message: 'Las cifras del PDF coinciden con lo reportado en la central.',
      },
    ],
  };
}

// ─── Dim 7: Riesgo de la central (puntajeScore + sector + mora) ─────────────
// Base = el puntaje de DataCrédito (150-950) mapeado a su banda estándar (ver
// SCORE_BANDS). Se penaliza por sector riesgoso y por mora reciente. El `nivel`
// (BAJO/MEDIO/ALTO) NO es la base: es solo contexto para el mensaje. Si no hay
// score, cae al nivel como respaldo; si tampoco hay nivel, no es evaluable.
function evalCentralRisk(central: CentralRiskInput | null): RawDimension {
  if (!central || (central.score === null && !central.nivelRiesgo)) {
    return { ratio: null, status: 'not_evaluable', alerts: [] };
  }

  // Base por banda de score. Sin score, se deriva del nivel (respaldo).
  let base: number;
  let bandLabel: string;
  if (central.score !== null) {
    const band = scoreToBand(central.score);
    base = band.ratio;
    bandLabel = `${band.label} (${central.score})`;
  } else {
    const nivel = (central.nivelRiesgo ?? '').trim().toUpperCase();
    base = nivel === 'BAJO' ? 0.9 : nivel === 'ALTO' ? 0.1 : 0.5;
    bandLabel = `nivel ${nivel || 'desconocido'}`;
  }

  // Penalización por sector riesgoso (ratingSectorial alto: 4, 5 o 'ALTO').
  const sector = (central.ratingSectorial ?? '').trim().toUpperCase();
  const sectorHigh = sector === 'ALTO' || sector === '4' || sector === '5';
  if (sectorHigh) base -= 0.15;

  // Penalización por mora GRADUADA por severidad y recencia (no un booleano):
  // mora reciente y severa (rangos 4-6 en meses cercanos) pesa mucho más que
  // mora antigua y leve. arrearsIndex ∈ 0..1; la penalización escala hasta el
  // máximo configurado.
  const arrearsIndex = weightedArrearsIndex(central.paymentBehavior);
  if (arrearsIndex > 0) base -= arrearsIndex * ARREARS_MAX_PENALTY;

  // NOTA: pedir por encima del montoSugerido ya NO penaliza esta dimensión.
  // Es una señal informativa que se alerta en la Capacidad de pago (contraste
  // pedido vs montoSugerido); el riesgo de la central se mide con lo que la
  // central sí sabe: score, sector y comportamiento de pago.

  const ratio = clamp(base, 0, 1);
  const status =
    ratio >= 0.8 ? 'low_risk' : ratio >= 0.4 ? 'medium_risk' : 'high_risk';
  const alertType =
    ratio >= 0.8 ? 'success' : ratio >= 0.4 ? 'warning' : 'danger';
  const parts = [bandLabel];
  if (sectorHigh) parts.push('sector de alto riesgo');
  if (arrearsIndex >= ARREARS_FLAG_DANGER) parts.push('mora severa reciente');
  else if (arrearsIndex > 0) parts.push('mora en el historial');
  return {
    ratio,
    status,
    alerts: [
      {
        type: alertType,
        dimension: 'centralRisk',
        message: `Riesgo según la central: ${parts.join(', ')}.`,
      },
    ],
  };
}

// ─── Estado legal (eliminatorio) ────────────────────────────────────────────
// Devuelve el motivo si el estado legal descalifica al cliente (matrícula
// cancelada o empresa en liquidación), o null si está en regla. Compara
// normalizado (minúsculas, sin tildes/espacios).
function eliminatoryLegalReason(legal: LegalStatusInput | null): string | null {
  if (!legal) return null;
  const status = normalizeText(legal.registrationStatus);
  const liq = normalizeText(legal.inLiquidation);
  if (status && REGISTRATION_CANCELLED_VALUES.includes(status)) {
    return `Matrícula mercantil CANCELADA según la central (${legal.registrationStatus}). Una empresa con matrícula cancelada no es sujeto de crédito.`;
  }
  if (liq && IN_LIQUIDATION_VALUES.includes(liq)) {
    return 'La empresa se encuentra EN LIQUIDACIÓN según la central. No es sujeto de crédito.';
  }
  return null;
}

// ─── Riesgo alto de la central (cap de veredicto) ───────────────────────────
// ¿La central marca a este cliente como riesgo alto? True si el puntaje está por
// debajo del piso (banda de riesgo alto) o el nivel de riesgo es MÁXIMO/ALTO.
// Usado para topar el veredicto a 'conditional' (el PDF no lo puede aprobar).
function centralMarksHighRisk(central: CentralRiskInput | null): boolean {
  if (!central) return false;
  if (central.score !== null && central.score < CENTRAL_SCORE_CONDITIONAL_CAP) {
    return true;
  }
  const nivel = normalizeText(central.nivelRiesgo);
  return nivel !== '' && CENTRAL_MAX_RISK_LEVELS.includes(nivel);
}

// ─── Índice ponderado de mora (severidad × recencia) ────────────────────────
// Recorre el vector de comportamiento (más antiguo → más reciente) y produce un
// índice 0..1: promedio ponderado de la severidad de cada mes, dando más peso a
// los meses recientes (los últimos ARREARS_RECENT_WINDOW pesan progresivamente
// más). 0 = sin mora; 1 = mora máxima y reciente.
function weightedArrearsIndex(vector: PaymentBehaviorMonth[] | null): number {
  if (!vector || vector.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  const n = vector.length;
  vector.forEach((m, i) => {
    const code = (m.comportamiento ?? '').trim().toUpperCase();
    const severity = ARREARS_SEVERITY[code];
    if (severity === undefined) return; // 'N', '-', ' ' o desconocido → se ignora
    // Recencia: distancia desde el final (0 = más reciente). Los últimos meses
    // pesan más; fuera de la ventana pesan 1 (base).
    const fromEnd = n - 1 - i;
    const recencyWeight =
      fromEnd < ARREARS_RECENT_WINDOW
        ? 1 + (ARREARS_RECENT_WINDOW - fromEnd) / ARREARS_RECENT_WINDOW
        : 1;
    weightedSum += severity * recencyWeight;
    weightTotal += recencyWeight;
  });
  return weightTotal > 0 ? clamp(weightedSum / weightTotal, 0, 1) : 0;
}

// ─── Red flags de la central ────────────────────────────────────────────────
// Deriva señales de riesgo del snapshot de la central (estado legal, mora,
// endeudamiento, monto sugerido 0, score muy bajo) como red flags tipadas.
function buildCentralRiskFlags(
  legal: LegalStatusInput | null,
  central: CentralRiskInput | null,
): CentralRiskFlag[] {
  // Se acumulan sin categoryLabel; se resuelve el label en el return (un solo
  // punto → imposible olvidar el label al agregar una flag nueva).
  const flags: Array<Omit<CentralRiskFlag, 'categoryLabel'>> = [];

  // Estado legal.
  const legalReason = eliminatoryLegalReason(legal);
  if (legalReason) {
    flags.push({
      severity: 'danger',
      category: 'legal_status',
      title: 'Estado legal descalificante',
      detail: legalReason,
    });
  }

  if (!central) return withCategoryLabels(flags);

  // Mora graduada.
  const arrears = weightedArrearsIndex(central.paymentBehavior);
  if (arrears >= ARREARS_FLAG_DANGER) {
    flags.push({
      severity: 'danger',
      category: 'payment_behavior',
      title: 'Mora severa y reciente en la central',
      detail: describeWorstArrears(central.paymentBehavior),
    });
  } else if (arrears >= ARREARS_FLAG_WARNING) {
    flags.push({
      severity: 'warning',
      category: 'payment_behavior',
      title: 'Mora en el historial de pago',
      detail: describeWorstArrears(central.paymentBehavior),
    });
  }

  // Monto sugerido 0 (la central no avala ningún monto).
  if (central.montoSugerido === 0) {
    flags.push({
      severity: 'danger',
      category: 'suggested_amount',
      title: 'La central no avala ningún monto',
      detail:
        'El monto sugerido por la central es $0: no reconoce capacidad de endeudamiento para este cliente.',
    });
  }

  // Saldo actualmente en mora (dinero vencido reportado en la central).
  if (central.saldoMora !== null && central.saldoMora > 0) {
    flags.push({
      severity: 'danger',
      category: 'indebtedness',
      title: 'Saldo en mora vigente en la central',
      detail: `El cliente tiene ${money(central.saldoMora)} actualmente en mora según la central.`,
    });
  }

  // Endeudamiento alto (porcentaje de deuda usado).
  if (central.porcentajeDeuda !== null) {
    if (central.porcentajeDeuda >= DEBT_RATIO_DANGER) {
      flags.push({
        severity: 'danger',
        category: 'indebtedness',
        title: 'Endeudamiento muy alto',
        detail: `El nivel de endeudamiento reportado por la central es ${central.porcentajeDeuda.toFixed(1)}%.`,
      });
    } else if (central.porcentajeDeuda >= DEBT_RATIO_WARNING) {
      flags.push({
        severity: 'warning',
        category: 'indebtedness',
        title: 'Endeudamiento elevado',
        detail: `El nivel de endeudamiento reportado por la central es ${central.porcentajeDeuda.toFixed(1)}%.`,
      });
    }
  }

  // Score muy bajo (banda de riesgo alto).
  if (central.score !== null && central.score < CENTRAL_SCORE_CONDITIONAL_CAP) {
    flags.push({
      severity: 'warning',
      category: 'score',
      title: 'Puntaje de la central en riesgo alto',
      detail: `El puntaje de la central es ${central.score}, dentro de la banda de riesgo alto (< ${CENTRAL_SCORE_CONDITIONAL_CAP}).`,
    });
  }

  return withCategoryLabels(flags);
}

// Resuelve la etiqueta legible (español) de cada red flag de la central a partir
// de su código de categoría. Punto único: al agregar una flag no hay que
// recordar el label.
function withCategoryLabels(
  flags: Array<Omit<CentralRiskFlag, 'categoryLabel'>>,
): CentralRiskFlag[] {
  return flags.map((f) => ({
    ...f,
    categoryLabel: CENTRAL_RISK_FLAG_CATEGORY_LABEL[f.category] ?? f.category,
  }));
}

// Describe el peor mes de mora del vector para el detalle de la red flag.
function describeWorstArrears(vector: PaymentBehaviorMonth[] | null): string {
  if (!vector || vector.length === 0) return 'Mora registrada en la central.';
  let worst: { code: string; anioMes: string; severity: number } | null = null;
  for (const m of vector) {
    const code = (m.comportamiento ?? '').trim().toUpperCase();
    const severity = ARREARS_SEVERITY[code];
    if (severity === undefined || severity === 0) continue;
    if (!worst || severity > worst.severity) {
      worst = { code, anioMes: m.anioMes ?? '', severity };
    }
  }
  if (!worst) return 'Mora registrada en la central.';
  const dias: Record<string, string> = {
    '1': '30 días',
    '2': '60 días',
    '3': '90 días',
    '4': '120 días',
    '5': '150 días',
    '6': '180 días',
    C: 'cartera castigada',
    D: 'dudoso recaudo',
  };
  const label = dias[worst.code] ?? `código ${worst.code}`;
  return `Peor registro: mora de ${label} en ${worst.anioMes}.`;
}

// ─── Redistribución de pesos ────────────────────────────────────────────────
// Entre las dimensiones HABILITADAS, el peso de las NO evaluables (sin datos) se
// reparte proporcionalmente entre las evaluables, para que el score siga en
// escala 0..100. Las deshabilitadas no entran aquí: no tienen peso que repartir.
function redistributeWeights(
  enabled: ScoringDimension[],
  weights: Partial<Record<ScoringDimension, number>>,
  raw: Record<ScoringDimension, RawDimension>,
): Record<ScoringDimension, number> {
  const evaluables = enabled.filter((d) => raw[d].ratio !== null);
  const missingWeight = enabled
    .filter((d) => raw[d].ratio === null)
    .reduce((sum, d) => sum + weights[d]!, 0);
  const evaluableWeightSum = evaluables.reduce(
    (sum, d) => sum + weights[d]!,
    0,
  );

  const result = {} as Record<ScoringDimension, number>;
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

// ─── Monto aprobado por Creditia ────────────────────────────────────────────
// Regla única: el monto lo mandan los EEFF (sean de DataCrédito o del PDF). El
// techo es el máximo pagable según la capacidad de pago para el plazo pedido;
// dentro de él se avala lo pedido, por encima se recorta. El montoSugerido de
// la central NO recorta: en el mercado real suele ser muy conservador frente a
// lo que los EEFF del cliente soportan; queda como referencia (señal/alertas).
function resolveApprovedCredit(
  requested: number | null,
  ind: ScoringIndicators,
  req: StudyRequest,
  suggestedByBureau: number | null,
): ScoringResult['approvedCreditLine'] {
  // Sin cupo solicitado no hay qué avalar ni recortar.
  if (requested === null) {
    return {
      amount: null,
      requested,
      suggestedByBureau,
      cappedByCapacity: false,
    };
  }
  const maxPayable = maxPayableForTerm(ind, req);
  const capped = requested > maxPayable;
  return {
    amount: capped ? Math.round(maxPayable) : requested,
    requested,
    suggestedByBureau,
    cappedByCapacity: capped,
  };
}

/**
 * Máximo pagable según los EEFF para el plazo pedido: capacidad de pago mensual
 * × meses del plazo. Sin plazo (0/null) se asume 1 mes (misma convención que
 * monthlyQuota). Capacidad negativa → 0 (no hay monto avalable; la regla
 * eliminatoria de capacidad <= 0 rechaza el estudio aguas arriba).
 */
function maxPayableForTerm(ind: ScoringIndicators, req: StudyRequest): number {
  const term = req.requestedTerm ?? 0;
  const months = term > 0 ? term / 30 : 1;
  return Math.max(ind.monthlyPaymentCapacity, 0) * months;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function monthlyQuota(req: StudyRequest): number {
  const credit = req.requestedCreditLine ?? 0;
  const term = req.requestedTerm ?? 0;
  const months = term > 0 ? term / 30 : 1;
  return credit / months;
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
function money(v: number): string {
  return `$${Math.round(v).toLocaleString('es-CO')}`;
}
/** minúsculas, sin tildes ni espacios extra (para comparar estados legales). */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
