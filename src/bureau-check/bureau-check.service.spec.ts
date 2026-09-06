// Tests de las funciones puras de la consulta de riesgo: el contraste de monto
// (determinístico, en código) y la validación del JSON del modelo.

import {
  buildAmountComparison,
  buildPaymentTimeline,
  buildPaymentStats,
  buildBalanceTrend,
  buildSectorTotals,
  namesMatch,
  normalizeAnalysis,
} from './bureau-check-analysis.utils.js';

describe('buildAmountComparison', () => {
  it('dentro del sugerido', () => {
    const r = buildAmountComparison(8_000_000, 10_000_000);
    expect(r.verdict).toBe('within');
    expect(r.ratio).toBe(0.8);
  });

  it('por encima (hasta 1.5x)', () => {
    const r = buildAmountComparison(12_000_000, 10_000_000);
    expect(r.verdict).toBe('above');
    expect(r.ratio).toBe(1.2);
    expect(r.verdictLabel).toContain('1.2x');
  });

  it('muy por encima (más de 1.5x)', () => {
    const r = buildAmountComparison(30_000_000, 10_000_000);
    expect(r.verdict).toBe('far_above');
    expect(r.ratio).toBe(3);
  });

  it('sin monto solicitado o sin referencia → not_comparable', () => {
    expect(buildAmountComparison(null, 10_000_000).verdict).toBe(
      'not_comparable',
    );
    expect(buildAmountComparison(8_000_000, null).verdict).toBe(
      'not_comparable',
    );
    expect(buildAmountComparison(8_000_000, 0).verdict).toBe('not_comparable');
  });
});

describe('normalizeAnalysis', () => {
  const valid = {
    summary: 'Perfil sano con endeudamiento moderado.',
    riskLevel: 'low',
    redFlags: [
      { severity: 'danger', title: 'Mora vigente', detail: '$500.000 en mora' },
    ],
    positiveSignals: [{ title: 'Score alto', detail: '780 puntos' }],
    sections: {
      indebtedness: 'a',
      paymentHabits: 'b',
      alerts: 'c',
      income: 'd',
    },
  };

  it('acepta la salida bien formada', () => {
    const a = normalizeAnalysis(valid);
    expect(a.riskLevel).toBe('low');
    expect(a.redFlags).toHaveLength(1);
    expect(a.redFlags[0].severity).toBe('danger');
    expect(a.sections.income).toBe('d');
  });

  it('sin summary o riskLevel inválido → error reintentable', () => {
    expect(() => normalizeAnalysis({ ...valid, summary: '' })).toThrow(
      'formato esperado',
    );
    expect(() =>
      normalizeAnalysis({ ...valid, riskLevel: 'critical' }),
    ).toThrow('formato esperado');
  });

  it('sanea listas: filtra ítems vacíos y coerce severity desconocida a warning', () => {
    const a = normalizeAnalysis({
      ...valid,
      redFlags: [
        { severity: 'fatal', title: 'X', detail: 'y' },
        { title: '', detail: '' },
        'basura',
      ],
      positiveSignals: 'no-es-lista',
      sections: null,
    });
    expect(a.redFlags).toHaveLength(1);
    expect(a.redFlags[0].severity).toBe('warning');
    expect(a.positiveSignals).toEqual([]);
    expect(a.sections.indebtedness).toBe('');
  });
});

describe('normalizeAnalysis · recommendations', () => {
  const base = {
    summary: 'ok',
    riskLevel: 'medium',
    redFlags: [],
    positiveSignals: [],
    sections: {},
  };

  it('lee la lista y filtra ítems vacíos', () => {
    const a = normalizeAnalysis({
      ...base,
      recommendations: [
        { title: 'Pedir certificación laboral', detail: 'Contrato y salario' },
        { title: '', detail: '' },
      ],
    });
    expect(a.recommendations).toHaveLength(1);
    expect(a.recommendations[0].title).toBe('Pedir certificación laboral');
  });

  it('sin recommendations → lista vacía (compatible con análisis viejos)', () => {
    expect(normalizeAnalysis(base).recommendations).toEqual([]);
  });
});

describe('buildPaymentTimeline / buildPaymentStats', () => {
  const behavior = [
    { anioMes: '2026-03', comportamiento: '2', comportamientoLabel: 'Mora de 60 días' },
    { anioMes: '2026-01', comportamiento: 'N', comportamientoLabel: 'Al día' },
    { anioMes: '2026-02', comportamiento: 'N', comportamientoLabel: 'Al día' },
    { anioMes: '2026-04', comportamiento: '-', comportamientoLabel: 'Sin información' },
    { anioMes: '2026-05', comportamiento: 'C', comportamientoLabel: 'Cartera castigada' },
  ];

  it('ordena cronológico y clasifica severidad', () => {
    const t = buildPaymentTimeline(behavior);
    expect(t.map((p) => p.month)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    ]);
    expect(t.map((p) => p.status)).toEqual([
      'ok', 'ok', 'delay', 'unknown', 'severe',
    ]);
  });

  it('estadísticas sobre meses con dato; peor = castigo; mora reciente', () => {
    const s = buildPaymentStats(buildPaymentTimeline(behavior));
    expect(s).not.toBeNull();
    expect(s!.monthsWithData).toBe(4); // el '-' no cuenta
    expect(s!.onTimePct).toBe(50);
    expect(s!.delayMonths).toBe(2);
    expect(s!.worstLabel).toBe('Cartera castigada');
    expect(s!.lastDelayMonth).toBe('2026-05');
  });

  it('sin historia → timeline vacía y stats null', () => {
    expect(buildPaymentTimeline(null)).toEqual([]);
    expect(buildPaymentStats([])).toBeNull();
  });
});

describe('buildBalanceTrend', () => {
  const point = (period: string, saldo: number | null) => ({
    period,
    saldo,
    cuota: null,
  });

  it('a la baja / al alza / estable según el cambio del saldo', () => {
    expect(
      buildBalanceTrend([point('T1', 10_000_000), point('T4', 6_000_000)])!
        .direction,
    ).toBe('down');
    expect(
      buildBalanceTrend([point('T1', 10_000_000), point('T4', 15_000_000)])!
        .direction,
    ).toBe('up');
    expect(
      buildBalanceTrend([point('T1', 10_000_000), point('T4', 10_500_000)])!
        .direction,
    ).toBe('stable');
  });

  it('con menos de 2 puntos con saldo → null', () => {
    expect(buildBalanceTrend(null)).toBeNull();
    expect(buildBalanceTrend([point('T1', 10_000_000)])).toBeNull();
    expect(buildBalanceTrend([point('T1', null), point('T2', null)])).toBeNull();
  });
});

describe('buildSectorTotals', () => {
  const sector = (over: Record<string, unknown>) => ({
    sector: 'Sector Financiero',
    sectorLabel: null,
    creditosVigentes: '0',
    creditosCerrados: '0',
    saldoActual: null,
    saldoMora: null,
    porcentajeDeuda: null,
    valorInicial: null,
    valorCuota: null,
    totalPrincipal: null,
    totalCodeudorOtros: null,
    ...over,
  });

  it('suma vigentes/cerrados y cuotas; null cuando ningún sector trae el dato', () => {
    const t = buildSectorTotals([
      sector({ creditosVigentes: '2', valorCuota: 500_000, totalCodeudorOtros: 1_000_000 }),
      sector({ creditosCerrados: '3', valorCuota: 250_000 }),
    ] as never);
    expect(t.vigentes).toBe(2);
    expect(t.cerrados).toBe(3);
    expect(t.valorCuota).toBe(750_000);
    expect(t.totalCodeudorOtros).toBe(1_000_000);

    const empty = buildSectorTotals([sector({})] as never);
    expect(empty.valorCuota).toBeNull();
    expect(empty.totalCodeudorOtros).toBeNull();
  });
});

describe('namesMatch', () => {
  it('coincide sin importar tildes, mayúsculas ni orden parcial', () => {
    expect(namesMatch('Gabriel Herrera Rueda', 'GABRIEL HERRERA RUEDA')).toBe(true);
    expect(namesMatch('herrera rueda', 'GABRIEL HERRERA RUEDA')).toBe(true);
    expect(namesMatch('José Pérez', 'JOSE PEREZ GOMEZ')).toBe(true);
  });

  it('no coincide cuando hay tokens ajenos; null cuando falta un lado', () => {
    expect(namesMatch('Pedro Gómez', 'GABRIEL HERRERA RUEDA')).toBe(false);
    expect(namesMatch(null, 'GABRIEL HERRERA')).toBeNull();
    expect(namesMatch('Gabriel', null)).toBeNull();
  });
});
