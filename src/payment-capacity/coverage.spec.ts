// Cobertura de la ventana: qué meses cuenta REALMENTE un extracto. El caso que
// motiva estas pruebas es el extracto trimestral de Bancolombia, que arranca en
// el corte anterior (2026-03-31) y hacía contar marzo como un mes completo.

import {
  computeCoverage,
  isPayrollPeriodCurrent,
  monthsInRange,
  previousMonth,
} from './coverage.js';

describe('monthsInRange', () => {
  it('no cuenta el mes del corte anterior (extracto trimestral Bancolombia)', () => {
    // 2026-03-31 → 2026-06-30: de marzo solo entra el día 31.
    expect(monthsInRange('2026-03-31', '2026-06-30')).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('cuenta los meses completos de un rango calendario', () => {
    expect(monthsInRange('2026-04-01', '2026-06-30')).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('con corte a mitad de mes cuenta el mes con más de 15 días', () => {
    // Abril entra con 16 días (15..30); julio queda fuera con 14 (1..14).
    expect(monthsInRange('2026-04-15', '2026-07-14')).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('un mes con exactamente 15 días cubiertos cuenta', () => {
    expect(monthsInRange('2026-04-16', '2026-04-30')).toEqual(['2026-04']);
  });

  it('un mes con 14 días cubiertos no cuenta', () => {
    expect(monthsInRange('2026-04-17', '2026-04-30')).toEqual([]);
  });

  it('cruza el fin de año', () => {
    expect(monthsInRange('2025-11-30', '2026-02-28')).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('devuelve vacío con un rango invertido o inválido', () => {
    expect(monthsInRange('2026-06-30', '2026-03-31')).toEqual([]);
    expect(monthsInRange('no-es-fecha', '2026-06-30')).toEqual([]);
  });
});

describe('computeCoverage', () => {
  it('el extracto trimestral cubre 3 meses, no 4', () => {
    const coverage = computeCoverage({
      employmentType: 'salaried',
      statementPeriods: [{ from: '2026-03-31', to: '2026-06-30' }],
      payrollStubs: 1,
      contractorInvoices: 0,
      now: new Date('2026-07-10T00:00:00Z'),
    });
    expect(coverage.months).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(coverage.coveredMonths).toBe(3);
    // 3 meses exactos siguen habilitando el análisis del asalariado.
    expect(coverage.complete).toBe(true);
  });

  it('sin desprendible el asalariado no puede analizar', () => {
    const coverage = computeCoverage({
      employmentType: 'salaried',
      statementPeriods: [{ from: '2026-03-31', to: '2026-06-30' }],
      payrollStubs: 0,
      contractorInvoices: 0,
      now: new Date('2026-07-10T00:00:00Z'),
    });
    expect(coverage.incomeDocOk).toBe(false);
    expect(coverage.complete).toBe(false);
  });
});

describe('isPayrollPeriodCurrent', () => {
  it('acepta el desprendible del mes anterior al primer mes cubierto', () => {
    // Con la cobertura corregida el primer mes es abril → marzo sigue valiendo.
    expect(
      isPayrollPeriodCurrent('2026-03', ['2026-04', '2026-05', '2026-06']),
    ).toBe(true);
    expect(
      isPayrollPeriodCurrent('2026-06', ['2026-04', '2026-05', '2026-06']),
    ).toBe(true);
  });

  it('rechaza un desprendible muy anterior a la ventana', () => {
    expect(
      isPayrollPeriodCurrent('2024-12', ['2026-04', '2026-05', '2026-06']),
    ).toBe(false);
  });

  it('sin extractos todavía no puede afirmar que no corresponde', () => {
    expect(isPayrollPeriodCurrent('2024-12', [])).toBe(true);
  });
});

describe('previousMonth', () => {
  it('retrocede un mes cruzando el año', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-04')).toBe('2026-03');
  });
});
