// Obligaciones detectadas en el extracto. Las cifras salen del extracto real de
// Bancolombia 2026-03-31→2026-06-30: son las que motivaron el cambio, porque el
// informe imprimía promedios ($244.905, $337.718) que no aparecen en ninguna
// parte del PDF y que el lector no podía cuadrar.

import {
  detectObligations,
  isCardCashIn,
  normalizeCounterparty,
} from './movement-recurrence.js';
import type {
  BankMovement,
  MovementCategory,
} from '../extraction/extraction.types.js';

const WINDOW = ['2026-04', '2026-05', '2026-06'];

const mv = (
  date: string,
  rawDescription: string,
  amount: number,
  category: MovementCategory,
  counterparty: string | null = null,
): BankMovement => ({
  date,
  rawDescription,
  amount,
  balance: 0,
  category,
  counterparty,
});

describe('normalizeCounterparty', () => {
  it('unifica las variantes societarias del mismo acreedor', () => {
    expect(normalizeCounterparty('FINESA S.A.')).toBe(
      normalizeCounterparty('FINESA S A'),
    );
    expect(normalizeCounterparty('P.A. ADDI')).toBe(
      normalizeCounterparty('P A ADDI'),
    );
    expect(normalizeCounterparty('PEXTO COLOMBIA SAS')).toBe(
      normalizeCounterparty('PEXTO COLOMBIA S.A.S'),
    );
  });

  it('NUNCA mezcla acreedores distintos', () => {
    expect(normalizeCounterparty('FINESA S.A.')).not.toBe(
      normalizeCounterparty('P.A. ADDI'),
    );
    expect(normalizeCounterparty('BANCO DE BOGOTA')).not.toBe(
      normalizeCounterparty('BANCO DE OCCIDENTE'),
    );
  });

  it('no destroza nombres que solo contienen las letras de una forma societaria', () => {
    expect(normalizeCounterparty('CASA SALUD')).toBe('CASA SALUD');
  });
});

describe('detectObligations', () => {
  it('FINESA queda en UNA fila con su cuota real de los 3 meses', () => {
    // El banco escribe "S.A." en abril y "S A" en mayo/junio; partido en dos,
    // el informe mostraba $232.425 y $115.869 en vez de la cuota de $348.295.
    const obligations = detectObligations(
      [
        mv(
          '2026-04-28',
          'PAGO PSE FINESA S.A.',
          -347608,
          'loan_payment',
          'FINESA S.A.',
        ),
        mv(
          '2026-05-28',
          'PAGO PSE FINESA S A',
          -348638,
          'loan_payment',
          'FINESA SA',
        ),
        mv(
          '2026-06-30',
          'PAGO PSE FINESA S A',
          -348638,
          'loan_payment',
          'FINESA SA',
        ),
      ],
      WINDOW,
    );

    expect(obligations).toHaveLength(1);
    const finesa = obligations[0];
    expect(finesa.counterparty).toBe('FINESA SA'); // etiqueta real del extracto
    expect(finesa.totalAmount).toBe(1044884);
    expect(finesa.paymentCount).toBe(3);
    expect(finesa.monthlyAverage).toBeCloseTo(348294.67, 2);
    expect(finesa.monthlyTotals).toEqual([
      { month: '2026-04', amount: 347608 },
      { month: '2026-05', amount: 348638 },
      { month: '2026-06', amount: 348638 },
    ]);
  });

  it('un pago que no es mensual muestra el total y los meses en cero', () => {
    // ADDI: $734.714 en abril y $1.013.153,04 en junio. El promedio sigue
    // siendo total ÷ 3, pero ahora el desglose enseña por qué.
    const obligations = detectObligations(
      [
        mv(
          '2026-04-22',
          'PAGO PSE P.A. ADDI',
          -734714,
          'loan_payment',
          'P.A. ADDI',
        ),
        mv(
          '2026-06-23',
          'PAGO PSE P A ADDI',
          -1013153.04,
          'loan_payment',
          'P A ADDI',
        ),
      ],
      WINDOW,
    );

    expect(obligations).toHaveLength(1);
    const addi = obligations[0];
    expect(addi.totalAmount).toBeCloseTo(1747867.04, 2);
    expect(addi.monthlyAverage).toBeCloseTo(582622.35, 2);
    expect(addi.months).toEqual(['2026-04', '2026-06']);
    expect(addi.monthlyTotals[1]).toEqual({ month: '2026-05', amount: 0 });
    // La cifra que sí está en el PDF viaja en el detalle, y la división también.
    expect(addi.detail).toContain('1.747.867');
    expect(addi.detail).toContain('÷ 3');
  });

  it('el total es siempre la suma del desglose: lo de fuera de la ventana no entra', () => {
    // El extracto trimestral arranca en el corte anterior (31/03): ese día no
    // es un mes cubierto, así que tampoco puede engordar el total.
    const [obligation] = detectObligations(
      [
        mv(
          '2026-03-31',
          'PAGO PSE FINESA S A',
          -900000,
          'loan_payment',
          'FINESA SA',
        ),
        mv(
          '2026-04-28',
          'PAGO PSE FINESA S A',
          -347608,
          'loan_payment',
          'FINESA SA',
        ),
      ],
      WINDOW,
    );

    expect(obligation.totalAmount).toBe(347608);
    expect(obligation.paymentCount).toBe(1);
    expect(obligation.monthlyTotals.reduce((a, m) => a + m.amount, 0)).toBe(
      obligation.totalAmount,
    );
  });

  it('mantiene separados a dos acreedores distintos', () => {
    const obligations = detectObligations(
      [
        mv(
          '2026-04-28',
          'PAGO PSE FINESA S.A.',
          -347608,
          'loan_payment',
          'FINESA S.A.',
        ),
        mv(
          '2026-04-22',
          'PAGO PSE P.A. ADDI',
          -734714,
          'loan_payment',
          'P.A. ADDI',
        ),
      ],
      WINDOW,
    );

    expect(obligations.map((o) => o.counterparty).sort()).toEqual([
      'FINESA S.A.',
      'P.A. ADDI',
    ]);
  });

  it('la cuota probable exige el mismo monto en 2+ meses', () => {
    const obligations = detectObligations(
      [
        mv(
          '2026-04-22',
          'TRASLADO VIRTUAL OTROS BANCOS',
          -1104600,
          'recurring_transfer_out',
          'TRASLADO VIRTUAL OTROS BANCOS',
        ),
        mv(
          '2026-05-23',
          'TRASLADO VIRTUAL OTROS BANCOS',
          -1104600,
          'recurring_transfer_out',
          'TRASLADO VIRTUAL OTROS BANCOS',
        ),
        mv(
          '2026-06-23',
          'TRASLADO VIRTUAL OTROS BANCOS',
          -1104600,
          'recurring_transfer_out',
          'TRASLADO VIRTUAL OTROS BANCOS',
        ),
      ],
      WINDOW,
    );

    expect(obligations).toHaveLength(1);
    expect(obligations[0].kind).toBe('probable_installment');
    expect(obligations[0].totalAmount).toBe(3313800);
    expect(obligations[0].monthlyAverage).toBe(1104600);
  });

  it('ignora las transferencias que solo nombran el canal', () => {
    const obligations = detectObligations(
      [
        mv(
          '2026-04-22',
          'TRANSFERENCIA CTA SUC VIRTUAL',
          -500000,
          'recurring_transfer_out',
          'TRANSFERENCIA CTA SUC VIRTUAL',
        ),
        mv(
          '2026-05-23',
          'TRANSFERENCIA CTA SUC VIRTUAL',
          -500000,
          'recurring_transfer_out',
          'TRANSFERENCIA CTA SUC VIRTUAL',
        ),
      ],
      WINDOW,
    );

    expect(obligations).toEqual([]);
  });
});

describe('isCardCashIn', () => {
  it('detecta el avance aunque el prompt lo haya tomado por traslado propio', () => {
    // 18/06: entran $900.000 con la cuenta en -13.760 y ese mismo día salen
    // $888.126 a otra tarjeta. Es deuda entrando, no plata propia.
    const advance = mv(
      '2026-06-18',
      'TRANSFERENCIA TC SUC VIRTUAL',
      900000,
      'self_transfer_in',
    );
    expect(isCardCashIn(advance)).toBe(true);
  });

  it('no confunde el traslado entre cuentas propias (CTA, no TC)', () => {
    const own = mv(
      '2026-06-05',
      'TRANSFERENCIA CTA SUC VIRTUAL',
      120000,
      'self_transfer_in',
    );
    expect(isCardCashIn(own)).toBe(false);
  });

  it('una devolución de la tarjeta no es un avance', () => {
    const refund = mv(
      '2026-05-25',
      'SALDO A FAVOR TARJETA CREDITO',
      1192.17,
      'interest',
    );
    expect(isCardCashIn(refund)).toBe(false);
  });

  it('el pago de la tarjeta tampoco (es un cargo)', () => {
    const payment = mv(
      '2026-04-07',
      'PAGO SUC VIRT TC MASTER PESOS',
      -2982543,
      'cc_payment',
    );
    expect(isCardCashIn(payment)).toBe(false);
  });
});
