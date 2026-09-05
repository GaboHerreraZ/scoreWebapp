// Tests del motor de scoring de capacidad: mismos umbrales y política que el
// motor EEFF (75/40, caps de la central, redistribución de no evaluables),
// dimensiones evaluadas con los indicadores de flujo de caja.

import { runPaymentCapacityScoring } from './payment-capacity.engine.js';
import { PAYMENT_CAPACITY_DEFAULT_WEIGHTS } from './payment-capacity.constants.js';
import type { PaymentCapacityIndicatorsResult } from '../indicators/payment-capacity-indicators.js';
import type { CentralRiskInput } from '../../scoring/scoring.types.js';

/** Indicadores de un cliente sano (base de los tests; cada caso muta lo suyo). */
const healthyIndicators = (
  overrides: Partial<PaymentCapacityIndicatorsResult> = {},
): PaymentCapacityIndicatorsResult => ({
  verifiedMonthlyIncome: 16_000_000,
  payrollNetIncome: null,
  bankStatementIncome: 16_000_000,
  incomeVerificationIndex: null,
  incomeCv: 0.09,
  monthsWithIncome: 6,
  windowMonths: 6,
  coveredMonths: 6,
  paysOwnSocialSecurity: true,
  verifiedHireDate: '2022-01-15',
  hireDateSource: 'declared',
  recurringFixedExpenses: 1_000_000,
  existingDebtPayments: 2_000_000,
  debtServicePayments: 2_000_000,
  cardPayments: 0,
  livingCost: 1_500_000,
  availableIncome: 13_000_000,
  maxSuggestedInstallment: 4_800_000, // min(30% × 16M, 70% × 13M) = 4.8M
  payrollLoanCapacity: null,
  currentDti: 0.125,
  behavior: {
    averageBalance: 5_000_000,
    minBalance: 500_000,
    daysNegative: 0,
    daysAtZero: 0,
    pctWithdrawn48h: 0.3,
    gamblingMonthlyAvg: 0,
    gamblingPctOfIncome: 0,
    walletTransfersMonthlyAvg: 0,
    walletTransfersCount: 0,
    cardCashInTotal: 0,
  },
  monthlyIncomeSeries: [],
  detectedObligations: [],
  invoiceChecks: [],
  payroll: null,
  indicatorFlags: [],
  ...overrides,
});

const goodCentral: CentralRiskInput = {
  nivelRiesgo: null,
  ratingSectorial: null,
  viabilidad: 'ALTA',
  ratingRecaudos: 'A',
  score: 780,
  montoSugerido: 20_000_000,
  porcentajeDeuda: 20,
  saldoMora: 0,
  reportedIncome: null,
  quotaToIncomePct: null,
  hasArrears: false,
  paymentBehavior: null,
};

const baseInput = () => ({
  weights: PAYMENT_CAPACITY_DEFAULT_WEIGHTS,
  // Este estudio NO pide plazo: el monto viaja solo como contexto.
  request: { requestedTerm: null, requestedCreditLine: 10_000_000 },
  employmentType: 'independent' as const,
  indicators: healthyIndicators(),
  centralRisk: goodCentral,
  validationOutcomes: [
    {
      code: 'V1' as const,
      label: 'Continuidad del saldo',
      passed: true,
      severity: 'danger' as const,
      detail: 'ok',
    },
  ],
  reliabilityFlags: [],
  recencyOk: true,
});

describe('runPaymentCapacityScoring', () => {
  it('aprueba a un cliente sano y el score cuadra con las contribuciones', () => {
    const result = runPaymentCapacityScoring(baseInput());
    expect(result.summary.status).toBe('approved');
    expect(result.summary.eliminatoryReason).toBeNull();

    const contributions = Object.values(result.dimensions).reduce(
      (a, d) => a + d.contribution,
      0,
    );
    // Invariante: el score ES la suma de las contribuciones mostradas (ambos a
    // 1 decimal), no una suma aparte con otro redondeo.
    expect(result.summary.totalScore).toBeCloseTo(contributions, 5);
    for (const d of Object.values(result.dimensions)) {
      expect(Math.round(d.contribution * 10) / 10).toBe(d.contribution);
    }
    // Las 5 dimensiones habilitadas participan y sus pesos suman 100. NO hay
    // dimensión de capacidad: la capacidad es el resultado, no un factor.
    expect(Object.keys(result.dimensions)).toHaveLength(5);
    expect(result.dimensions.paymentCapacity).toBeUndefined();
    const weightSum = Object.values(result.dimensions).reduce(
      (a, d) => a + d.weight,
      0,
    );
    expect(weightSum).toBeCloseTo(100, 5);
    // El bloque propio del estudio de capacidad viaja en el resultado.
    expect(result.capacityFigures.verifiedMonthlyIncome).toBe(16_000_000);
    expect(result.capacityFigures.maxSuggestedInstallment).toBe(4_800_000);
    // Creditia no avala cupo: el monto queda como contexto y el contraste dice
    // en cuántas cuotas cabría (10M ÷ 4.8M = 2.08 → 3).
    expect(result.approvedCreditLine.amount).toBeNull();
    expect(result.approvedCreditLine.requested).toBe(10_000_000);
    expect(result.capacityFigures.minInstallmentsForRequested).toBe(3);
  });

  it('el score NO depende del monto solicitado', () => {
    // La misma persona, pidiendo 10x más: mismo puntaje y mismas dimensiones.
    const small = runPaymentCapacityScoring(baseInput());
    const large = runPaymentCapacityScoring({
      ...baseInput(),
      request: { requestedTerm: null, requestedCreditLine: 100_000_000 },
    });
    expect(large.summary.totalScore).toBe(small.summary.totalScore);
    expect(large.summary.status).toBe(small.summary.status);
    // Lo único que cambia es el contraste informativo.
    expect(large.capacityFigures.minInstallmentsForRequested).toBe(21);
  });

  it('redistribuye el peso de la central cuando no hay consulta', () => {
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      centralRisk: null,
    });
    expect(result.dimensions.centralRisk.evaluable).toBe(false);
    expect(result.dimensions.centralRisk.weight).toBe(0);
    // El peso total sigue siendo 100 (repartido entre las evaluables).
    const weightSum = Object.values(result.dimensions).reduce(
      (a, d) => a + d.weight,
      0,
    );
    expect(weightSum).toBeCloseTo(100, 5);
  });

  it('sin cuota sostenible avisa que el monto no es pagable en ningún plazo', () => {
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      indicators: healthyIndicators({
        availableIncome: 100,
        maxSuggestedInstallment: 0,
      }),
    });
    expect(result.capacityFigures.minInstallmentsForRequested).toBeNull();
    expect(
      result.alerts.some(
        (a) => a.type === 'danger' && a.message.includes('ningún plazo'),
      ),
    ).toBe(true);
  });

  it('rechaza por eliminatoria cuando el ingreso está totalmente comprometido', () => {
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      indicators: healthyIndicators({
        recurringFixedExpenses: 8_000_000,
        existingDebtPayments: 9_000_000,
        availableIncome: -1_000_000,
        maxSuggestedInstallment: 0,
      }),
    });
    expect(result.summary.status).toBe('rejected');
    expect(result.summary.eliminatoryReason).toContain('comprometido');
  });

  it('rechaza por eliminatoria cuando no hay ingreso verificable', () => {
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      indicators: healthyIndicators({
        verifiedMonthlyIncome: 0,
        bankStatementIncome: 0,
        availableIncome: 0,
        maxSuggestedInstallment: 0,
      }),
    });
    expect(result.summary.status).toBe('rejected');
    expect(result.summary.eliminatoryReason).toContain('ingreso');
  });

  it('la central sin historia no puntúa como riesgo alto (thin file)', () => {
    // MiDecisor responde así a un titular sin historial: score 0 (fuera de la
    // escala real, que arranca en ~150) y rating 'N' = sin información.
    const thinFile: CentralRiskInput = {
      ...goodCentral,
      score: 0,
      viabilidad: 'BAJA',
      ratingRecaudos: 'N',
      montoSugerido: 2_407_134,
      porcentajeDeuda: 0,
      saldoMora: 0,
      hasArrears: false,
      paymentBehavior: null,
    };
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      centralRisk: thinFile,
    });

    // No evaluable: su peso se redistribuye, no se castiga con ratio 0.
    expect(result.dimensions.centralRisk.evaluable).toBe(false);
    expect(result.dimensions.centralRisk.weight).toBe(0);
    const weightSum = Object.values(result.dimensions).reduce(
      (a, d) => a + d.weight,
      0,
    );
    expect(weightSum).toBeCloseTo(100, 5);
    // Y no se levantan red flags sobre un puntaje que la central no dio.
    expect(result.centralRiskFlags).toHaveLength(0);
    expect(
      result.alerts.some((a) => a.message.includes('no tiene historia')),
    ).toBe(true);

    // Sin el castigo, el mismo titular puntúa por encima que con score 0 real.
    const withRealBadScore = runPaymentCapacityScoring({
      ...baseInput(),
      centralRisk: { ...thinFile, ratingRecaudos: 'C', hasArrears: true },
    });
    expect(result.summary.totalScore).toBeGreaterThan(
      withRealBadScore.summary.totalScore,
    );
  });

  it('topa en condicional cuando la central marca riesgo alto', () => {
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      centralRisk: { ...goodCentral, score: 400 },
    });
    expect(result.summary.status).not.toBe('approved');
  });

  it('el DTI actual crítico tumba la dimensión de endeudamiento', () => {
    // Cuotas que YA paga: 9M sobre 16M = 56% → crítico (> 45%).
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      indicators: healthyIndicators({
        existingDebtPayments: 9_000_000,
        availableIncome: 6_000_000,
        currentDti: 0.5625,
      }),
    });
    expect(result.dimensions.indebtedness.ratio).toBe(0);
    expect(result.capacityFigures.currentDti).toBeGreaterThan(0.45);
  });

  it('castiga la veracidad documental con validaciones fallidas', () => {
    const result = runPaymentCapacityScoring({
      ...baseInput(),
      validationOutcomes: [
        {
          code: 'V1',
          label: 'Continuidad del saldo',
          passed: false,
          severity: 'danger',
          detail: 'filas que no cuadran',
        },
        {
          code: 'V7',
          label: 'Cuenta de depósito',
          passed: false,
          severity: 'danger',
          detail: 'la nómina cae en otra cuenta',
        },
      ],
    });
    expect(result.dimensions.docVeracity.ratio).toBeLessThanOrEqual(0.3);
    expect(result.dimensions.docVeracity.status).toBe('suspect');
  });
});
