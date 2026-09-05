// Tests de las validaciones determinísticas V1–V10 y sus helpers, con los
// casos reales de la muestra: titular truncado por Bancolombia, cédula con
// sufijo, cuenta de depósito ****0937, neto en letras del desprendible.

import {
  validateBankStatementInternals,
  validateContractorInvoice,
  validateDepositAccountMatch,
  validateIdentity,
  validatePayrollStub,
  validateSeriesContinuity,
} from './document-validations.js';
import { idNumbersMatch, namesMatch, normalizeName } from './identity-match.js';
import { parseSpanishAmountWords } from '../../common/utils/number-words-es.js';
import type {
  BankStatementExtraction,
  PayrollStubExtraction,
} from '../extraction/extraction.types.js';

const baseStatement = (
  overrides: Partial<BankStatementExtraction> = {},
): BankStatementExtraction => ({
  docType: 'bank_statement',
  account: {
    bank: 'Bancolombia',
    accountType: 'savings',
    accountNumberLast4: '0937',
    holderName: 'GABRIEL GIOVANY HERRERA ZAR',
    branch: null,
  },
  period: { from: '2026-04-01', to: '2026-04-30' },
  summary: {
    previousBalance: 1_000_000,
    totalCredits: 5_000_000,
    totalDebits: 2_000_000,
    finalBalance: 4_000_000,
    averageBalance: null,
    interestPaid: null,
    withholding: null,
  },
  movements: [
    {
      date: '2026-04-10',
      rawDescription: 'ABONO',
      amount: 5_000_000,
      balance: 6_000_000,
      category: 'income_other',
      counterparty: null,
    },
    {
      date: '2026-04-15',
      rawDescription: 'PAGO',
      amount: -1_500_000,
      balance: 4_500_000,
      category: 'purchase',
      counterparty: null,
    },
    {
      date: '2026-04-20',
      rawDescription: 'PAGO',
      amount: -500_000,
      balance: 4_000_000,
      category: 'purchase',
      counterparty: null,
    },
  ],
  ...overrides,
});

const baseStub = (
  overrides: Partial<PayrollStubExtraction> = {},
): PayrollStubExtraction => ({
  docType: 'payroll_stub',
  employer: { name: 'Sistemas Colombia SAS', nit: '900218578-7' },
  employee: {
    name: 'Gabriel Herrera',
    idType: 'CC',
    idNumber: '109621657-9',
    employeeNumber: null,
    position: null,
    division: null,
  },
  period: '2024-12',
  hireDate: '2024-07-22',
  baseSalary: 8_150_000,
  funds: { health: null, pension: null, severance: null },
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
      code: 'BN07',
      concept: 'Medicina Prepa Colsanitas',
      quantity: 0,
      earning: 637_200,
      deduction: null,
    },
    {
      code: '2T40',
      concept: 'COLSANITAS',
      quantity: 0,
      earning: null,
      deduction: 637_200,
    },
  ],
  totals: { earnings: 9_487_619, deductions: 1_785_320 },
  netPay: 7_702_299,
  netPayInWords:
    'SIETE MILLONES SETECIENTOS DOS MIL DOSCIENTOS NOVENTA Y NUEVE PESOS',
  signature: { signed: true, timestamp: null },
  ...overrides,
});

describe('V1–V3, V6 — internos del extracto', () => {
  it('pasa con saldo corrido, resumen y fechas consistentes', () => {
    const outcomes = validateBankStatementInternals(baseStatement());
    const byCode = Object.fromEntries(outcomes.map((o) => [o.code, o]));
    expect(byCode.V1.passed).toBe(true);
    expect(byCode.V2.passed).toBe(true);
    expect(byCode.V3.passed).toBe(true);
    expect(byCode.V6.passed).toBe(true);
  });

  it('V1 detecta una fila que rompe el saldo corrido (movimiento borrado)', () => {
    const doc = baseStatement();
    doc.movements[1] = { ...doc.movements[1], balance: 4_400_000 };
    const v1 = validateBankStatementInternals(doc).find((o) => o.code === 'V1');
    expect(v1!.passed).toBe(false);
  });

  it('V2 detecta un resumen que no cuadra (extracto editado)', () => {
    const doc = baseStatement();
    doc.summary = { ...doc.summary, finalBalance: 5_000_000 };
    const v2 = validateBankStatementInternals(doc).find((o) => o.code === 'V2');
    expect(v2!.passed).toBe(false);
  });

  it('V6 detecta movimientos fuera del período (páginas mezcladas)', () => {
    const doc = baseStatement();
    doc.movements.push({
      date: '2026-05-03',
      rawDescription: 'PAGO',
      amount: -10_000,
      balance: 3_990_000,
      category: 'purchase',
      counterparty: null,
    });
    const v6 = validateBankStatementInternals(doc).find((o) => o.code === 'V6');
    expect(v6!.passed).toBe(false);
  });
});

describe('V4 — continuidad de la serie entre PDFs', () => {
  it('pasa cuando los períodos empalman y el saldo final = inicial siguiente', () => {
    const april = baseStatement();
    const may = baseStatement({
      period: { from: '2026-05-01', to: '2026-05-31' },
      summary: {
        ...baseStatement().summary,
        previousBalance: 4_000_000,
        finalBalance: 6_000_000,
      },
    });
    const outcomes = validateSeriesContinuity([april, may]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].passed).toBe(true);
  });

  it('falla cuando el saldo no empalma o hay un salto de período', () => {
    const april = baseStatement();
    const june = baseStatement({
      period: { from: '2026-06-01', to: '2026-06-30' },
      summary: { ...baseStatement().summary, previousBalance: 9_999_999 },
    });
    const outcomes = validateSeriesContinuity([april, june]);
    expect(outcomes[0].passed).toBe(false);
    expect(outcomes[0].detail).toContain('salto de período');
  });
});

describe('V5 — identidad del titular (match difuso)', () => {
  it('tolera el truncamiento de Bancolombia y el orden de la central', () => {
    // "HERRERA ZAR" (truncado) debe matchear "Herrera Zárate" (central).
    expect(
      namesMatch(
        'GABRIEL GIOVANY HERRERA ZAR',
        'HERRERA ZARATE GABRIEL GIOVANY',
      ),
    ).toBe(true);
    // Forma corta de la nómina ⊂ nombre completo.
    expect(
      namesMatch('Gabriel Herrera', 'HERRERA ZARATE GABRIEL GIOVANY'),
    ).toBe(true);
    // Un tercero NO pasa.
    expect(namesMatch('PEDRO PEREZ', 'HERRERA ZARATE GABRIEL GIOVANY')).toBe(
      false,
    );
    // Un solo apellido compartido no identifica a nadie.
    expect(namesMatch('HERRERA', 'HERRERA ZARATE GABRIEL GIOVANY')).toBe(false);
  });

  it('normaliza tildes y mojibake', () => {
    expect(normalizeName('Zárate')).toBe('ZARATE');
    expect(normalizeName('HERRERA¥ZAR8TE')).toBe('HERRERA ZAR TE');
  });

  it('valida el conjunto de titulares contra el Customer', () => {
    const ok = validateIdentity(
      [
        { source: 'extracto', name: 'GABRIEL GIOVANY HERRERA ZAR' },
        { source: 'desprendible', name: 'Gabriel Herrera' },
      ],
      'HERRERA ZARATE GABRIEL GIOVANY',
    );
    expect(ok.passed).toBe(true);

    const impostor = validateIdentity(
      [{ source: 'extracto', name: 'PEDRO PEREZ LOPEZ' }],
      'HERRERA ZARATE GABRIEL GIOVANY',
    );
    expect(impostor.passed).toBe(false);
  });

  it('compara cédulas tolerando puntos, guiones y el sufijo del software', () => {
    expect(idNumbersMatch('109621657-9', '1096216579')).toBe(true);
    expect(idNumbersMatch('1.096.216.579', '1096216579')).toBe(true);
    // Un dígito extra pegado al final (formato del software de nómina).
    expect(idNumbersMatch('10962165791', '1096216579')).toBe(true);
    expect(idNumbersMatch('222222222', '1096216579')).toBe(false);
  });
});

describe('V7 — cuenta de depósito de la nómina = cuenta del extracto', () => {
  it('pasa cuando la nómina se consigna en la cuenta aportada (****0937)', () => {
    const outcome = validateDepositAccountMatch(
      [baseStub()],
      [baseStatement()],
    );
    expect(outcome.passed).toBe(true);
  });

  it('falla cuando el extracto aportado NO es donde cae el salario', () => {
    const stub = baseStub({
      depositAccount: {
        bank: 'Davivienda',
        accountType: '01',
        accountNumberLast4: '1234',
      },
    });
    const outcome = validateDepositAccountMatch([stub], [baseStatement()]);
    expect(outcome.passed).toBe(false);
  });

  it('queda no-evaluable si el desprendible no declara la cuenta', () => {
    const outcome = validateDepositAccountMatch(
      [baseStub({ depositAccount: null })],
      [baseStatement()],
    );
    expect(outcome.passed).toBeNull();
  });
});

describe('V8–V10 — internos del desprendible', () => {
  it('V8 verifica devengos − deducciones = neto', () => {
    const v8 = validatePayrollStub(baseStub()).find((o) => o.code === 'V8');
    expect(v8!.passed).toBe(true); // 9,487,619 − 1,785,320 = 7,702,299
  });

  it('V9 verifica el neto en letras contra el número', () => {
    const v9 = validatePayrollStub(baseStub()).find((o) => o.code === 'V9');
    expect(v9!.passed).toBe(true);

    const edited = baseStub({ netPay: 9_702_299 }); // número editado, letras no
    const v9edited = validatePayrollStub(edited).find((o) => o.code === 'V9');
    expect(v9edited!.passed).toBe(false);
  });

  it('V10 declara los conceptos espejo (Colsanitas devengo ↔ deducción)', () => {
    const v10 = validatePayrollStub(baseStub()).find((o) => o.code === 'V10');
    expect(v10!.detail).toContain('COLSANITAS');
  });

  it('la factura valida que los renglones sumen el total', () => {
    const ok = validateContractorInvoice({
      docType: 'contractor_invoice',
      invoiceNumber: 'INV-1',
      issueDate: '2026-08-25',
      period: null,
      contractor: { name: null, phone: null, city: null },
      client: { name: null, country: null },
      role: null,
      currency: 'USD',
      lineItems: [
        { description: 'Fixed rate', amount: 3322 },
        { description: 'Achievement', amount: 407 },
      ],
      total: 3729,
      approvedBy: null,
    });
    expect(ok[0].passed).toBe(true);
  });
});

describe('parseSpanishAmountWords', () => {
  it('interpreta el neto real del desprendible', () => {
    expect(
      parseSpanishAmountWords(
        'SIETE MILLONES SETECIENTOS DOS MIL DOSCIENTOS NOVENTA Y NUEVE PESOS',
      ),
    ).toBe(7_702_299);
  });

  it('interpreta formas comunes', () => {
    expect(parseSpanishAmountWords('UN MILLON DOSCIENTOS MIL PESOS')).toBe(
      1_200_000,
    );
    expect(parseSpanishAmountWords('QUINIENTOS MIL')).toBe(500_000);
    expect(parseSpanishAmountWords('VEINTIUN MIL CIEN')).toBe(21_100);
  });

  it('devuelve null cuando no puede interpretar', () => {
    expect(parseSpanishAmountWords('VALOR EN LETRAS ILEGIBLE XYZ')).toBeNull();
  });
});
