// La clasificación consolidada se aplica con desconfianza: la respuesta del
// modelo solo pasa si cubre todos los movimientos con categorías válidas, y
// aplicar jamás toca la transcripción (montos/fechas/saldos de V1–V3).

import {
  applyClassifications,
  buildClassificationInput,
  countMovements,
  parseClassifications,
} from './movement-classification.js';
import { buildMovementClassificationUserMessage } from '../../ai/prompts/movement-classification.prompt.js';
import type {
  BankMovement,
  BankStatementExtraction,
  ContractorInvoiceExtraction,
  MovementCategory,
} from '../extraction/extraction.types.js';

const mv = (
  date: string,
  rawDescription: string,
  amount: number,
  category: MovementCategory,
): BankMovement => ({
  date,
  rawDescription,
  amount,
  balance: 100,
  category,
  counterparty: null,
});

const statement = (
  from: string,
  to: string,
  movements: BankMovement[],
): BankStatementExtraction => ({
  docType: 'bank_statement',
  account: {
    bank: 'Banco Caja Social',
    accountType: 'savings',
    accountNumberLast4: '8435',
    holderName: 'OSCAR RUEDA SERRANO',
    branch: null,
  },
  period: { from, to },
  summary: {
    previousBalance: null,
    totalCredits: null,
    totalDebits: null,
    finalBalance: null,
    averageBalance: null,
    interestPaid: null,
    withholding: null,
  },
  movements,
});

const mayo = statement('2026-05-01', '2026-05-31', [
  mv(
    '2026-05-29',
    'TRANSFERENCIA OTRA ENTIDA Honorarios',
    1_700_000,
    'unknown',
  ),
  mv('2026-05-03', 'COMPRA EN CANAL ELECTRONI', -85_000, 'purchase'),
]);
const junio = statement('2026-06-01', '2026-06-30', [
  mv(
    '2026-06-02',
    'TRANSFERENCIA OTRA ENTIDA Honorarios',
    4_375_000,
    'income_other',
  ),
]);

describe('buildClassificationInput', () => {
  it('indexa globalmente en el orden de los extractos', () => {
    const input = buildClassificationInput(
      [mayo, junio],
      'OSCAR RUEDA',
      'independent',
    );
    expect(input.statements[0].movements.map((m) => m.i)).toEqual([0, 1]);
    expect(input.statements[1].movements[0].i).toBe(2);
    expect(input.statements[1].movements[0].draft).toBe('income_other');
    expect(input.employmentType).toBe('independent');
  });
});

describe('parseClassifications', () => {
  it('acepta una respuesta completa y válida', () => {
    const byIndex = parseClassifications(
      {
        classifications: [
          { i: 0, category: 'income_other' },
          { i: 1, category: 'purchase' },
          { i: 2, category: 'income_other' },
        ],
      },
      3,
    );
    expect(byIndex.get(0)).toBe('income_other');
  });

  it('rechaza respuestas incompletas: mejor el borrador que media clasificación', () => {
    expect(() =>
      parseClassifications(
        { classifications: [{ i: 0, category: 'income_other' }] },
        3,
      ),
    ).toThrow(/cubre 1 de 3/);
  });

  it('rechaza categorías fuera de la taxonomía', () => {
    expect(() =>
      parseClassifications(
        { classifications: [{ i: 0, category: 'plata_magica' }] },
        1,
      ),
    ).toThrow(/Categoría inválida/);
  });

  it('rechaza índices fuera de rango o repetidos', () => {
    expect(() =>
      parseClassifications(
        { classifications: [{ i: 9, category: 'purchase' }] },
        1,
      ),
    ).toThrow(/fuera de rango/);
    expect(() =>
      parseClassifications(
        {
          classifications: [
            { i: 0, category: 'purchase' },
            { i: 0, category: 'unknown' },
          ],
        },
        2,
      ),
    ).toThrow(/repetido/);
  });
});

describe('applyClassifications', () => {
  it('aplica las categorías definitivas sin tocar la transcripción', () => {
    const byIndex = parseClassifications(
      {
        classifications: [
          { i: 0, category: 'income_other' }, // los Honorarios de mayo, por fin
          { i: 1, category: 'purchase' },
          { i: 2, category: 'income_other' },
        ],
      },
      3,
    );
    const applied = applyClassifications([mayo, junio], byIndex);

    expect(applied.changedCount).toBe(1);
    expect(applied.statements[0].movements[0].category).toBe('income_other');
    // Transcripción intacta y originales no mutados.
    expect(applied.statements[0].movements[0].amount).toBe(1_700_000);
    expect(mayo.movements[0].category).toBe('unknown');
  });
});

describe('countMovements', () => {
  it('cuenta sobre todos los extractos', () => {
    expect(countMovements([mayo, junio])).toBe(3);
  });
});

describe('contexto de facturas para la clasificación', () => {
  const invoice: ContractorInvoiceExtraction = {
    docType: 'contractor_invoice',
    invoiceNumber: null,
    issueDate: '2026-07-30',
    period: { from: '2026-07-01', to: '2026-07-31' },
    contractor: { name: 'OSCAR RUEDA SERRANO', phone: null, city: null },
    client: { name: 'MEDICID IPS S.A.S.', country: 'CO' },
    role: null,
    currency: 'COP',
    lineItems: [{ description: 'Revisoría fiscal', amount: 2_120_000 }],
    total: 2_120_000,
    approvedBy: null,
  };

  it('resume las facturas en el input y el mensaje las incluye', () => {
    const input = buildClassificationInput([mayo], 'OSCAR', 'independent', [
      invoice,
    ]);
    expect(input.invoices[0]).toEqual({
      client: 'MEDICID IPS S.A.S.',
      concept: 'Revisoría fiscal',
      total: 2_120_000,
      currency: 'COP',
      month: '2026-07',
    });
    expect(buildMovementClassificationUserMessage(input)).toContain(
      'facturasAportadas',
    );
  });

  it('sin facturas el input queda vacío y el mensaje no menciona el campo', () => {
    const input = buildClassificationInput([mayo], 'OSCAR', 'independent');
    expect(input.invoices).toEqual([]);
    expect(buildMovementClassificationUserMessage(input)).not.toContain(
      'facturasAportadas',
    );
  });
});
