// Tests del módulo puro de indicadores. La fixture "independiente" reproduce
// el ejemplo trabajado del doc de extracción (§6): 3 abonos Deel, self-transfer
// excluida, FINESA detectada, cuotas probables por recurrencia. La fixture
// "asalariado" reproduce el desprendible real (Globant/Sistemas Colombia).

import {
  classifyPayrollConcepts,
  computePaymentCapacityIndicators,
} from './payment-capacity-indicators.js';
import type {
  BankMovement,
  BankStatementExtraction,
  ContractorInvoiceExtraction,
  MovementCategory,
  PayrollStubExtraction,
} from '../extraction/extraction.types.js';

const mv = (
  date: string,
  rawDescription: string,
  amount: number,
  balance: number,
  category: MovementCategory,
  counterparty: string | null = null,
): BankMovement => ({
  date,
  rawDescription,
  amount,
  balance,
  category,
  counterparty,
});

const statement = (
  period: { from: string; to: string },
  movements: BankMovement[],
  summary: Partial<BankStatementExtraction['summary']> = {},
): BankStatementExtraction => ({
  docType: 'bank_statement',
  account: {
    bank: 'Bancolombia',
    accountType: 'savings',
    accountNumberLast4: '0937',
    holderName: 'GABRIEL GIOVANY HERRERA ZAR',
    branch: null,
  },
  period,
  summary: {
    previousBalance: null,
    totalCredits: null,
    totalDebits: null,
    finalBalance: null,
    averageBalance: null,
    interestPaid: null,
    withholding: null,
    ...summary,
  },
  movements,
});

// ─── Fixture independiente: abril–junio, patrón de la muestra real ─────────

const april = statement(
  { from: '2026-04-01', to: '2026-04-30' },
  [
    mv('2026-04-05', 'Electrificadora de S', -570_000, 2_000_000, 'utilities'),
    mv('2026-04-08', 'NETFLIX DL', -39_800, 1_960_200, 'subscription'),
    mv(
      '2026-04-10',
      'TRANSF DE GABRIEL HER',
      6_000_000,
      7_960_200,
      'self_transfer_in',
    ),
    mv(
      '2026-04-12',
      'TRANSFERENCIAS A NEQUI',
      -200_000,
      7_760_200,
      'wallet_transfer',
    ),
    mv(
      '2026-04-15',
      'TRANSFERENCIA TC SUC VIRTUAL',
      900_000,
      8_660_200,
      'cc_cash_in',
    ),
    mv(
      '2026-04-18',
      'PAGO PSE APORTES EN LINEA',
      -280_000,
      8_380_200,
      'social_security',
    ),
    mv(
      '2026-04-20',
      'TRANSFERENCIAS A NEQUI',
      -200_000,
      8_180_200,
      'wallet_transfer',
    ),
    mv(
      '2026-04-22',
      'TRANSF INTERNACIONAL RECIBIDA',
      17_552_976,
      25_733_176,
      'income_international',
    ),
    mv(
      '2026-04-23',
      'PAGO SUC VIRT TC MASTER PESOS',
      -14_400_000,
      11_333_176,
      'cc_payment',
      'TC MASTER',
    ),
    mv(
      '2026-04-24',
      'PAGO PSE FINESA S.A.',
      -348_600,
      10_984_576,
      'loan_payment',
      'FINESA S.A.',
    ),
    mv(
      '2026-04-25',
      'TRASLADO VIRTUAL OTROS BANCOS',
      -1_104_600,
      9_879_976,
      'recurring_transfer_out',
    ),
    mv(
      '2026-04-26',
      'TRANSF A GLOBAL COLOMBIA 81',
      -700_000,
      9_179_976,
      'recurring_transfer_out',
      'GLOBAL COLOMBIA',
    ),
    mv(
      '2026-04-27',
      'PAGO PSE Multitrust SKANDIA',
      -800_000,
      8_379_976,
      'pension_savings',
      'SKANDIA',
    ),
  ],
  {
    previousBalance: 2_570_000,
    totalCredits: 24_452_976,
    totalDebits: 18_643_000,
    finalBalance: 8_379_976,
    averageBalance: 1_980_000,
  },
);

const may = statement(
  { from: '2026-05-01', to: '2026-05-31' },
  [
    mv('2026-05-05', 'Electrificadora de S', -570_000, 7_809_976, 'utilities'),
    mv('2026-05-08', 'NETFLIX DL', -39_800, 7_770_176, 'subscription'),
    mv(
      '2026-05-12',
      'TRANSFERENCIAS A NEQUI',
      -200_000,
      7_570_176,
      'wallet_transfer',
    ),
    mv(
      '2026-05-18',
      'PAGO PSE APORTES EN LINEA',
      -280_000,
      7_290_176,
      'social_security',
    ),
    mv(
      '2026-05-20',
      'TRANSFERENCIAS A NEQUI',
      -200_000,
      7_090_176,
      'wallet_transfer',
    ),
    mv(
      '2026-05-21',
      'TRANSF INTERNACIONAL RECIBIDA',
      17_282_552,
      24_372_728,
      'income_international',
    ),
    mv(
      '2026-05-22',
      'PAGO SUC VIRT TC MASTER PESOS',
      -4_100_000,
      20_272_728,
      'cc_payment',
      'TC MASTER',
    ),
    mv(
      '2026-05-23',
      'PAGO PSE FINESA S.A.',
      -348_600,
      19_924_128,
      'loan_payment',
      'FINESA S.A.',
    ),
    mv(
      '2026-05-25',
      'TRASLADO VIRTUAL OTROS BANCOS',
      -1_104_600,
      18_819_528,
      'recurring_transfer_out',
    ),
    mv(
      '2026-05-26',
      'TRANSF A GLOBAL COLOMBIA 81',
      -700_000,
      18_119_528,
      'recurring_transfer_out',
      'GLOBAL COLOMBIA',
    ),
    mv(
      '2026-05-27',
      'PAGO PSE Multitrust SKANDIA',
      -800_000,
      17_319_528,
      'pension_savings',
      'SKANDIA',
    ),
  ],
  {
    previousBalance: 8_379_976,
    totalCredits: 17_282_552,
    totalDebits: 8_343_000,
    finalBalance: 17_319_528,
    averageBalance: 2_100_000,
  },
);

const june = statement(
  { from: '2026-06-01', to: '2026-06-30' },
  [
    mv('2026-06-02', 'COMPRA EN EXITO', -10_000_000, 7_319_528, 'purchase'),
    mv(
      '2026-06-03',
      'RETIRO CAJERO ATM',
      -7_000_000,
      319_528,
      'atm_withdrawal',
    ),
    mv('2026-06-05', 'Electrificadora de S', -570_000, -250_472, 'utilities'),
    mv('2026-06-08', 'NETFLIX DL', -39_800, -290_272, 'subscription'),
    mv(
      '2026-06-23',
      'TRANSF INTERNACIONAL RECIBIDA',
      14_234_628,
      13_944_356,
      'income_international',
    ),
    mv(
      '2026-06-24',
      'PAGO SUC VIRT TC MASTER PESOS',
      -3_700_000,
      10_244_356,
      'cc_payment',
      'TC MASTER',
    ),
    mv(
      '2026-06-25',
      'PAGO PSE FINESA S.A.',
      -348_600,
      9_895_756,
      'loan_payment',
      'FINESA S.A.',
    ),
    mv(
      '2026-06-26',
      'TRASLADO VIRTUAL OTROS BANCOS',
      -1_104_600,
      8_791_156,
      'recurring_transfer_out',
    ),
    mv(
      '2026-06-27',
      'TRANSF A GLOBAL COLOMBIA 81',
      -700_000,
      8_091_156,
      'recurring_transfer_out',
      'GLOBAL COLOMBIA',
    ),
    mv(
      '2026-06-28',
      'TRANSFERENCIAS A NEQUI',
      -200_000,
      7_891_156,
      'wallet_transfer',
    ),
    mv(
      '2026-06-28',
      'TRANSFERENCIAS A NEQUI',
      -200_000,
      7_691_156,
      'wallet_transfer',
    ),
    mv(
      '2026-06-29',
      'PAGO PSE APORTES EN LINEA',
      -280_000,
      7_411_156,
      'social_security',
    ),
    mv(
      '2026-06-30',
      'PAGO PSE Multitrust SKANDIA',
      -800_000,
      6_611_156,
      'pension_savings',
      'SKANDIA',
    ),
  ],
  {
    previousBalance: 17_319_528,
    totalCredits: 14_234_628,
    totalDebits: 24_943_000,
    finalBalance: 6_611_156,
    averageBalance: 1_850_000,
  },
);

const deelInvoice: ContractorInvoiceExtraction = {
  docType: 'contractor_invoice',
  invoiceNumber: 'INV-nrpe53n-2026-14',
  issueDate: '2026-04-25',
  period: { from: '2026-04-01', to: '2026-04-30' },
  contractor: {
    name: 'Gabriel Giovany Herrera Zarate',
    phone: null,
    city: 'Barrancabermeja',
  },
  client: { name: 'Lean Staffing Solutions, Inc', country: 'US' },
  role: 'Full Stack Developer',
  currency: 'USD',
  lineItems: [
    { description: 'Fixed rate: Monthly payment', amount: 3322 },
    { description: 'Contractual Achievement', amount: 407 },
  ],
  total: 3729,
  approvedBy: null,
};

// ─── Fixture asalariado: desprendible tipo Globant / Sistemas Colombia ─────

const globantStub: PayrollStubExtraction = {
  docType: 'payroll_stub',
  employer: { name: 'Sistemas Colombia SAS', nit: '900218578-7' },
  employee: {
    name: 'Gabriel Herrera',
    idType: 'CC',
    idNumber: '109621657-9',
    employeeNumber: '38020079',
    position: 'WEB UI DEVELOPER, SSR',
    division: 'Santander',
  },
  period: '2024-12',
  hireDate: '2024-07-22',
  baseSalary: 8_150_000,
  funds: { health: 'SANITAS', pension: 'SKANDIA', severance: 'PORVENIR' },
  depositAccount: {
    bank: 'Bancolombia',
    accountType: '02',
    accountNumberLast4: '0937',
  },
  concepts: [
    {
      code: 'M010',
      concept: 'Sueldo Básico',
      quantity: 28,
      earning: 7_606_667,
      deduction: null,
    },
    {
      code: '9730',
      concept: 'Vacaciones Días Hábiles',
      quantity: 2,
      earning: 543_334,
      deduction: null,
    },
    {
      code: 'BN07',
      concept: 'Medicina Prepa Colsanitas',
      quantity: 0,
      earning: 637_200,
      deduction: null,
    },
    {
      code: 'BONO',
      concept: 'Bono Proyectos',
      quantity: 0,
      earning: 700_418,
      deduction: null,
    },
    {
      code: '2T40',
      concept: 'COLSANITAS',
      quantity: 0,
      earning: null,
      deduction: 637_200,
    },
    {
      code: 'T000',
      concept: 'Descuento Salud',
      quantity: 30,
      earning: null,
      deduction: 333_201,
    },
    {
      code: 'T010',
      concept: 'Descuento Pensión',
      quantity: 30,
      earning: null,
      deduction: 421_919,
    },
    {
      code: 'T050',
      concept: 'Retención en la Fuente',
      quantity: 8.36,
      earning: null,
      deduction: 393_000,
    },
  ],
  totals: { earnings: 9_487_619, deductions: 1_785_320 },
  netPay: 7_702_299,
  netPayInWords:
    'SIETE MILLONES SETECIENTOS DOS MIL DOSCIENTOS NOVENTA Y NUEVE PESOS',
  signature: { signed: true, timestamp: '2025-02-03T08:59:14-05:00' },
};

describe('computePaymentCapacityIndicators — independiente (muestra §6)', () => {
  const result = computePaymentCapacityIndicators({
    employmentType: 'independent',
    statements: [april, may, june],
    payrollStubs: [],
    contractorInvoices: [deelInvoice],
  });

  it('promedia el ingreso mensual excluyendo lo que no es ingreso', () => {
    // (17,552,976 + 17,282,552 + 14,234,628) / 3 — la transferencia propia de
    // $6M y el avance de TC de $900k NO cuentan (inflarían el ingreso 12%).
    expect(result.bankStatementIncome).toBeCloseTo(16_356_718.67, 0);
    expect(result.verifiedMonthlyIncome).toBeCloseTo(16_356_718.67, 0);
    expect(result.monthsWithIncome).toBe(3);
    expect(result.coveredMonths).toBe(3);
    expect(result.windowMonths).toBe(3); // mínimo exigido, igual para ambos perfiles
  });

  it('mide la estabilidad: CV ≈ 9% (ingreso estable)', () => {
    expect(result.incomeCv).not.toBeNull();
    expect(result.incomeCv!).toBeCloseTo(0.092, 2);
  });

  it('detecta la cuota FINESA y las obligaciones probables por recurrencia', () => {
    const finesa = result.detectedObligations.find(
      (o) => o.counterparty === 'FINESA S.A.',
    );
    expect(finesa).toBeDefined();
    expect(finesa!.kind).toBe('loan');
    expect(finesa!.monthlyAverage).toBeCloseTo(348_600, 0);
    expect(finesa!.months).toEqual(['2026-04', '2026-05', '2026-06']);

    // $1,104,600 exacto tres meses seguidos = cuota probable en otra entidad.
    const traslado = result.detectedObligations.find(
      (o) => o.counterparty === 'TRASLADO VIRTUAL OTROS BANCOS',
    );
    expect(traslado).toBeDefined();
    expect(traslado!.kind).toBe('probable_installment');
    expect(traslado!.monthlyAverage).toBeCloseTo(1_104_600, 0);

    const global = result.detectedObligations.find(
      (o) => o.counterparty === 'GLOBAL COLOMBIA',
    );
    expect(global).toBeDefined();
    expect(global!.monthlyAverage).toBeCloseTo(700_000, 0);

    // El ahorro Skandia es discrecional: NO es obligación.
    expect(
      result.detectedObligations.some((o) =>
        o.counterparty.includes('SKANDIA'),
      ),
    ).toBe(false);
  });

  it('no inventa deuda con los traslados internos que no nombran beneficiario', () => {
    // "TRANSFERENCIA CTA SUC VIRTUAL" describe el canal, no a un acreedor: el
    // titular mueve plata entre sus propias cuentas del mismo banco. Aunque
    // llegue mal clasificada, no puede convertirse en cuota.
    const withInternalTransfers = computePaymentCapacityIndicators({
      employmentType: 'independent',
      statements: [
        statement({ from: '2026-04-01', to: '2026-05-31' }, [
          mv(
            '2026-04-10',
            'TRANSF INTERNACIONAL RECIBIDA',
            10_000_000,
            10_000_000,
            'income_international',
          ),
          mv(
            '2026-04-20',
            'TRANSFERENCIA CTA SUC VIRTUAL',
            -350_000,
            9_650_000,
            'recurring_transfer_out',
          ),
          mv(
            '2026-05-10',
            'TRANSF INTERNACIONAL RECIBIDA',
            10_000_000,
            19_650_000,
            'income_international',
          ),
          mv(
            '2026-05-20',
            'TRANSFERENCIA CTA SUC VIRTUAL',
            -350_000,
            19_300_000,
            'recurring_transfer_out',
          ),
        ]),
      ],
      payrollStubs: [],
      contractorInvoices: [],
    });

    expect(withInternalTransfers.detectedObligations).toHaveLength(0);
    expect(withInternalTransfers.existingDebtPayments).toBe(0);
  });

  it('calcula cuotas, disponible y cuota máxima (30% neto / 70% disponible)', () => {
    // FINESA 348,600 + TC promedio 7,400,000 + traslado 1,104,600 + global 700,000
    expect(result.existingDebtPayments).toBeCloseTo(9_553_200, 0);
    // Servicios 570,000 + Netflix 39,800 al mes.
    expect(result.recurringFixedExpenses).toBeCloseTo(609_800, 0);
    expect(result.availableIncome).toBeCloseTo(6_193_718.67, 0);
    // min(30% × 16.36M = 4,907,016; 70% × 6,193,719 = 4,335,603) → manda el
    // disponible real, no el ingreso bruto (la lectura del §6).
    expect(result.maxSuggestedInstallment).toBeCloseTo(4_335_603.07, 0);
  });

  it('el DTI mide el servicio de deuda SIN la tarjeta', () => {
    // La tarjeta sale de la cuenta (resta del disponible) pero no es cuota: el
    // extracto no distingue el pago mínimo del pago total.
    expect(result.cardPayments).toBeCloseTo(7_400_000, 0);
    // FINESA 348,600 + traslado 1,104,600 + global 700,000.
    expect(result.debtServicePayments).toBeCloseTo(2_153_200, 0);
    expect(result.existingDebtPayments).toBeCloseTo(
      result.debtServicePayments + result.cardPayments,
      0,
    );
    // 13% con la tarjeta afuera; contándola habría dado 58% y "crítico".
    expect(result.currentDti).toBeCloseTo(2_153_200 / 16_356_718.67, 4);
    expect(result.currentDti!).toBeLessThan(0.3);
  });

  it('cruza la factura Deel contra el abono internacional (TRM implícita)', () => {
    expect(result.invoiceChecks).toHaveLength(1);
    const check = result.invoiceChecks[0];
    expect(check.creditInMonth).toBe(17_552_976);
    expect(check.impliedRate).toBeCloseTo(4_707.15, 0); // dentro de 3,150–6,050
    expect(check.plausible).toBe(true);
  });

  it('detecta la formalidad (PILA propia) y las señales de comportamiento', () => {
    expect(result.paysOwnSocialSecurity).toBe(true);
    expect(result.behavior.averageBalance).toBeCloseTo(1_976_666.67, 0);
    expect(result.behavior.daysNegative).toBe(18); // junio en rojo hasta el abono
    expect(result.behavior.cardCashInTotal).toBe(900_000);
    expect(result.behavior.walletTransfersCount).toBe(6);
    expect(result.behavior.pctWithdrawn48h).not.toBeNull();

    const titles = result.indicatorFlags.map((f) => f.title);
    expect(titles).toContain('Transferencias a billetera digital');
    expect(titles).toContain('Avances de tarjeta de crédito hacia la cuenta');
  });

  // No hay DTI proyectado: el estudio no pide plazo, así que no existe cuota
  // nueva con la cual proyectar. Se juzga el endeudamiento que YA tiene.
  it('con la tarjeta afuera el endeudamiento deja de ser crítico, pero se avisa', () => {
    expect(
      result.indicatorFlags.some(
        (f) => f.title === 'Endeudamiento actual crítico',
      ),
    ).toBe(false);
    // La tarjeta se lleva el 45% del ingreso: no es deuda, pero sí es plata que
    // sale — el informe lo dice en vez de callarlo.
    expect(
      result.indicatorFlags.some(
        (f) =>
          f.title === 'El pago de tarjetas se lleva buena parte del ingreso',
      ),
    ).toBe(false);
    expect(result.cardPayments / result.verifiedMonthlyIncome).toBeCloseTo(
      0.4524,
      3,
    );
  });
});

describe('classifyPayrollConcepts — desprendible real (Globant)', () => {
  const breakdown = classifyPayrollConcepts([globantStub])!;

  it('netea el beneficio flexible espejo (Colsanitas devengo = deducción)', () => {
    expect(breakdown.mirroredAmount).toBe(637_200);
    // El espejo no cuenta como deducción "real" ni como devengo salarial.
    expect(breakdown.otherDeductions).toBe(0);
  });

  it('clasifica devengos y deducciones de ley', () => {
    expect(breakdown.salaryEarnings).toBe(7_606_667 + 700_418);
    expect(breakdown.seasonalEarnings).toBe(543_334); // vacaciones: no proyectable
    expect(breakdown.statutoryDeductions).toBe(333_201 + 421_919 + 393_000);
    expect(breakdown.libranzaDeductions).toBe(0);
    expect(breakdown.netAverage).toBe(7_702_299);
  });
});

describe('computePaymentCapacityIndicators — asalariado', () => {
  const december = statement(
    { from: '2024-12-01', to: '2024-12-31' },
    [
      mv(
        '2024-12-05',
        'Electrificadora de S',
        -300_000,
        1_000_000,
        'utilities',
      ),
      mv(
        '2024-12-28',
        'ABONO NOMINA SISTEMAS COLOMBIA',
        7_702_299,
        8_702_299,
        'income_payroll',
        'SISTEMAS COLOMBIA SAS',
      ),
    ],
    {
      previousBalance: 1_300_000,
      totalCredits: 7_702_299,
      totalDebits: 300_000,
      finalBalance: 8_702_299,
      averageBalance: 2_500_000,
    },
  );

  const result = computePaymentCapacityIndicators({
    employmentType: 'salaried',
    statements: [december],
    payrollStubs: [globantStub],
    contractorInvoices: [],
    declaredEmploymentStartDate: '2024-07-01',
  });

  it('verifica el neto de nómina contra el abono del extracto (índice = 1)', () => {
    expect(result.payrollNetIncome).toBe(7_702_299);
    expect(result.incomeVerificationIndex).toBeCloseTo(1.0, 4);
    expect(result.verifiedMonthlyIncome).toBe(7_702_299);
    expect(result.windowMonths).toBe(3);
  });

  it('usa la Fecha de Ingreso del desprendible como antigüedad verificada', () => {
    expect(result.verifiedHireDate).toBe('2024-07-22');
    expect(result.hireDateSource).toBe('payrollStub');
    // Declarada (jul-01) vs verificada (jul-22): < 6 meses, sin flag.
    expect(
      result.indicatorFlags.some(
        (f) => f.title === 'Antigüedad declarada vs verificada',
      ),
    ).toBe(false);
  });

  it('declara el desprendible de diciembre con conceptos estacionales', () => {
    expect(
      result.indicatorFlags.some(
        (f) => f.title === 'Desprendible con conceptos estacionales',
      ),
    ).toBe(true);
  });

  it('calcula el cupo de libranza (Ley 1527)', () => {
    // 0.5 × (8,307,085 − 1,148,120) − 0 = 3,579,482.5
    expect(result.payrollLoanCapacity).toBeCloseTo(3_579_482.5, 0);
  });

  it('castiga el ingreso cuando el índice de verificación lo desmiente', () => {
    const inflatedStub: PayrollStubExtraction = {
      ...globantStub,
      totals: { earnings: 12_000_000, deductions: 1_785_320 },
      netPay: 10_214_680, // neto "inflado": a la cuenta solo llegan 7.7M
    };
    const inflated = computePaymentCapacityIndicators({
      employmentType: 'salaried',
      statements: [december],
      payrollStubs: [inflatedStub],
      contractorInvoices: [],
    });
    expect(inflated.incomeVerificationIndex!).toBeLessThan(0.9);
    // Manda lo que llega a la cuenta, no lo que dice el papel.
    expect(inflated.verifiedMonthlyIncome).toBeCloseTo(7_702_299, 0);
    expect(
      inflated.indicatorFlags.some(
        (f) =>
          f.title === 'El ingreso declarado no es el que llega a la cuenta',
      ),
    ).toBe(true);
  });
});

// ─── Vigencia del desprendible ─────────────────────────────────────────────
// Un comprobante de un período anterior a la ventana no acredita el ingreso de
// hoy: manda el extracto, que sí está validado contra el saldo del banco.

describe('computePaymentCapacityIndicators — desprendible fuera del período', () => {
  // Extractos 2026-04..06 (≈16.36M/mes) contra un desprendible de 2024-12.
  const result = computePaymentCapacityIndicators({
    employmentType: 'salaried',
    statements: [april, may, june],
    payrollStubs: [globantStub],
    contractorInvoices: [],
    declaredEmploymentStartDate: '2014-02-01',
  });

  it('deja de usar el neto del desprendible y toma el ingreso de la cuenta', () => {
    expect(result.payrollNetIncome).toBe(7_702_299);
    expect(result.verifiedMonthlyIncome).toBeCloseTo(
      result.bankStatementIncome,
      0,
    );
    expect(result.verifiedMonthlyIncome).toBeGreaterThan(7_702_299);
  });

  it('no calcula el índice de verificación contra un período que no corresponde', () => {
    expect(result.incomeVerificationIndex).toBeNull();
  });

  it('declara el desfase como señal crítica', () => {
    const flag = result.indicatorFlags.find(
      (f) => f.title === 'Desprendible fuera del período analizado',
    );
    expect(flag?.severity).toBe('danger');
  });

  it('no emite cupo de libranza con un salario desactualizado', () => {
    expect(result.payrollLoanCapacity).toBeNull();
  });

  it('alerta por la antigüedad declarada con años de diferencia', () => {
    expect(
      result.indicatorFlags.some(
        (f) => f.title === 'Antigüedad declarada vs verificada',
      ),
    ).toBe(true);
  });

  it('marca la incoherencia del perfil cuando el asalariado paga su seguridad social', () => {
    expect(
      result.indicatorFlags.some(
        (f) => f.title === 'Perfil declarado vs evidencia de la cuenta',
      ),
    ).toBe(true);
  });
});

describe('computePaymentCapacityIndicators — desprendible vigente sin abono identificado', () => {
  // Mismo mes del desprendible, pero el abono de nómina no se reconoció como
  // tal: sin contraste, el papel no puede ganarle a lo que certifica el banco.
  const december = statement(
    { from: '2024-12-01', to: '2024-12-31' },
    [
      mv(
        '2024-12-05',
        'Electrificadora de S',
        -300_000,
        1_000_000,
        'utilities',
      ),
      mv(
        '2024-12-28',
        'ABONO DE TERCERO',
        5_000_000,
        6_000_000,
        'income_other',
      ),
    ],
    {
      previousBalance: 1_300_000,
      totalCredits: 5_000_000,
      totalDebits: 300_000,
      finalBalance: 6_000_000,
    },
  );

  const result = computePaymentCapacityIndicators({
    employmentType: 'salaried',
    statements: [december],
    payrollStubs: [globantStub],
    contractorInvoices: [],
  });

  it('manda lo que entra a la cuenta, no el neto declarado', () => {
    expect(result.incomeVerificationIndex).toBeNull();
    expect(result.verifiedMonthlyIncome).toBe(5_000_000);
  });

  it('mantiene el cupo de libranza: el desprendible sí es del período', () => {
    expect(result.payrollLoanCapacity).toBeCloseTo(3_579_482.5, 0);
  });

  it('también cuando la cuenta recibe MÁS que el desprendible', () => {
    // El caso del extracto real: desprendible de $7.7M y una cuenta que recibe
    // $16.4M. Tomar el menor mezclaba fuentes —ingreso del papel contra egresos
    // de la cuenta— y dejaba el disponible en negativo a un titular solvente.
    const rich = statement(
      { from: '2024-12-01', to: '2024-12-31' },
      [
        mv(
          '2024-12-20',
          'TRANSF INTERNACIONAL RECIBIDA',
          16_000_000,
          16_000_000,
          'income_international',
        ),
        mv(
          '2024-12-28',
          'PAGO PSE FINESA S A',
          -348_638,
          15_651_362,
          'loan_payment',
          'FINESA SA',
        ),
      ],
      {
        previousBalance: 0,
        totalCredits: 16_000_000,
        totalDebits: 348_638,
        finalBalance: 15_651_362,
      },
    );

    const richResult = computePaymentCapacityIndicators({
      employmentType: 'salaried',
      statements: [rich],
      payrollStubs: [globantStub],
      contractorInvoices: [],
    });

    expect(richResult.verifiedMonthlyIncome).toBe(16_000_000);
    expect(richResult.payrollNetIncome).toBe(7_702_299); // el declarado se conserva
    expect(richResult.availableIncome).toBeGreaterThan(0);
    expect(
      richResult.indicatorFlags.some((f) =>
        f.title.includes('Abono de nómina no detectado'),
      ),
    ).toBe(true);
  });
});

// ─── Cruce de facturas COP y ventana de extractos ──────────────────────────

describe('cruce factura ↔ extracto (COP y ventana)', () => {
  const copInvoice = (
    period: { from: string; to: string },
    total = 2_120_000,
  ): ContractorInvoiceExtraction => ({
    docType: 'contractor_invoice',
    invoiceNumber: null,
    issueDate: period.to,
    period,
    contractor: { name: 'OSCAR RUEDA SERRANO', phone: null, city: null },
    client: { name: 'MEDICID IPS S.A.S.', country: 'CO' },
    role: null,
    currency: 'COP',
    lineItems: [{ description: 'Revisoría fiscal', amount: total }],
    total,
    approvedBy: null,
  });

  const june = statement({ from: '2026-06-01', to: '2026-06-30' }, [
    // 2.120.000 − 10% retefuente: el abono real de una cuenta de cobro.
    mv(
      '2026-06-10',
      'TRANSFERENCIA OTRA ENTIDA',
      1_908_000,
      3_000_000,
      'income_other',
    ),
    mv(
      '2026-06-15',
      'COMPRA EN CANAL ELECTRONI',
      -80_000,
      2_920_000,
      'purchase',
    ),
    mv('2026-06-30', 'ABONO DE INTERESES', 110, 2_920_110, 'interest'),
  ]);

  it('COP: encuentra el abono individual aunque venga con retención', () => {
    const result = computePaymentCapacityIndicators({
      employmentType: 'independent',
      statements: [june],
      payrollStubs: [],
      contractorInvoices: [
        copInvoice({ from: '2026-06-01', to: '2026-06-30' }),
      ],
    });
    const check = result.invoiceChecks[0];
    expect(check.plausible).toBe(true);
    expect(check.outOfWindow).toBe(false);
    expect(check.creditInMonth).toBe(1_908_000);
  });

  it('COP: sin abono que corresponda → warning "sin respaldo"', () => {
    const result = computePaymentCapacityIndicators({
      employmentType: 'independent',
      statements: [june],
      payrollStubs: [],
      contractorInvoices: [
        copInvoice({ from: '2026-06-01', to: '2026-06-30' }, 9_500_000),
      ],
    });
    expect(result.invoiceChecks[0].plausible).toBe(false);
    expect(
      result.indicatorFlags.some((f) =>
        f.title.includes('sin respaldo en el extracto'),
      ),
    ).toBe(true);
  });

  it('factura de un mes que los extractos no cubren → info, no warning', () => {
    const result = computePaymentCapacityIndicators({
      employmentType: 'independent',
      statements: [june],
      payrollStubs: [],
      contractorInvoices: [
        copInvoice({ from: '2026-08-01', to: '2026-08-31' }),
      ],
    });
    const check = result.invoiceChecks[0];
    expect(check.outOfWindow).toBe(true);
    expect(check.plausible).toBeNull();
    const flag = result.indicatorFlags.find((f) =>
      f.title.includes('fuera de la ventana'),
    );
    expect(flag?.severity).toBe('info');
    expect(
      result.indicatorFlags.some((f) =>
        f.title.includes('sin respaldo en el extracto'),
      ),
    ).toBe(false);
  });
});

// ─── Endeudamiento bi-fuente: extractos vs cuota reportada por la central ──

describe('endeudamiento bi-fuente (extractos vs central)', () => {
  // La fixture independiente detecta cuotas por 2.153.200/mes en extractos
  // (FINESA + traslado fijo + global) y tarjetas por 7.400.000/mes.
  const base = {
    employmentType: 'independent' as const,
    statements: [april, may, june],
    payrollStubs: [],
    contractorInvoices: [],
  };

  it('cuando la central reporta más, manda la central (peor caso)', () => {
    const result = computePaymentCapacityIndicators({
      ...base,
      centralMonthlyQuota: 5_000_000,
    });
    expect(result.debtServicePayments).toBe(5_000_000);
    expect(result.currentDti).toBeCloseTo(5_000_000 / 16_356_718.67, 4);
    // El disponible también se encoge con la cifra de la central.
    expect(result.availableIncome).toBeCloseTo(
      16_356_718.67 - 609_800 - (5_000_000 + 7_400_000),
      0,
    );
    expect(
      result.indicatorFlags.some((f) =>
        f.title.includes('central reporta más cuotas'),
      ),
    ).toBe(true);
  });

  it('cuando la cuenta paga más de lo reportado, mandan los extractos + flag de deuda no reportada', () => {
    const result = computePaymentCapacityIndicators({
      ...base,
      centralMonthlyQuota: 300_000,
    });
    expect(result.debtServicePayments).toBeCloseTo(2_153_200, 0);
    expect(result.currentDti).toBeCloseTo(2_153_200 / 16_356_718.67, 4);
    expect(
      result.indicatorFlags.some((f) =>
        f.title.includes('la central no reporta'),
      ),
    ).toBe(true);
  });

  it('sin dato de la central (thin file) nada cambia y no hay flags de divergencia', () => {
    const result = computePaymentCapacityIndicators(base);
    expect(result.centralMonthlyQuota).toBeNull();
    expect(result.debtServicePayments).toBeCloseTo(2_153_200, 0);
    expect(
      result.indicatorFlags.some(
        (f) =>
          f.title.includes('central reporta') ||
          f.title.includes('la central no reporta'),
      ),
    ).toBe(false);
  });
});
