// ─── Clasificación consolidada: armado del payload y aplicación segura ──────
// Módulo puro (sin IO). La IA devuelve una categoría por índice; aquí se
// valida esa respuesta con desconfianza —índices completos, categorías del
// catálogo— y se aplica SIN tocar la transcripción (fechas, montos y saldos
// verificados por V1–V3 son intocables). Si la respuesta no pasa la
// validación, el llamador cae a las categorías borrador de la extracción:
// clasificación mala nunca puede ser peor que clasificación vieja.

import {
  MOVEMENT_CATEGORIES,
  type BankStatementExtraction,
  type ContractorInvoiceExtraction,
  type MovementCategory,
} from '../extraction/extraction.types.js';
import type {
  ClassifiableMovement,
  MovementClassificationInput,
} from '../../ai/prompts/movement-classification.prompt.js';

const VALID_CATEGORIES: ReadonlySet<string> = new Set(MOVEMENT_CATEGORIES);

/**
 * Payload compacto para la llamada de clasificación. El índice `i` es global y
 * estable (extractos en el orden recibido, movimientos en el orden del PDF):
 * es la única llave para mapear la respuesta de vuelta.
 */
export function buildClassificationInput(
  statements: BankStatementExtraction[],
  holderName: string | null,
  employmentType: 'salaried' | 'independent',
  invoices: ContractorInvoiceExtraction[] = [],
): MovementClassificationInput {
  let index = 0;
  return {
    holderName,
    employmentType,
    // Contexto del negocio: clientes conocidos y montos facturados. Ayuda a
    // amarrar abonos ACH anónimos a clientes reales (regla 6 del prompt).
    invoices: invoices.map((inv) => ({
      client: inv.client?.name ?? null,
      concept: inv.role ?? inv.lineItems[0]?.description ?? null,
      total: inv.total,
      currency: inv.currency,
      month: (inv.period?.from ?? inv.issueDate)?.slice(0, 7) ?? null,
    })),
    statements: statements.map((s) => ({
      bank: s.account?.bank ?? 'desconocido',
      period: s.period,
      movements: s.movements.map(
        (m): ClassifiableMovement => ({
          i: index++,
          date: m.date,
          description: m.rawDescription,
          counterparty: m.counterparty,
          amount: m.amount,
          draft: m.category,
        }),
      ),
    })),
  };
}

export interface ClassificationEntry {
  i: number;
  category: string;
}

/** Resultado de aplicar la clasificación consolidada. */
export interface AppliedClassification {
  /** Extractos con las categorías definitivas (transcripción intacta). */
  statements: BankStatementExtraction[];
  /** Movimientos cuya categoría cambió respecto del borrador. */
  changedCount: number;
  totalMovements: number;
}

/**
 * Parsea y valida la respuesta del modelo. Lanza (con motivo) si la respuesta
 * no es utilizable — el llamador decide el fallback, no este módulo.
 */
export function parseClassifications(
  raw: unknown,
  totalMovements: number,
): Map<number, MovementCategory> {
  const list = (raw as { classifications?: unknown })?.classifications;
  if (!Array.isArray(list)) {
    throw new Error('La respuesta no trae el arreglo "classifications".');
  }
  const byIndex = new Map<number, MovementCategory>();
  for (const entry of list as ClassificationEntry[]) {
    const i = entry?.i;
    const category = entry?.category;
    if (!Number.isInteger(i) || i < 0 || i >= totalMovements) {
      throw new Error(`Índice fuera de rango en la clasificación: ${i}.`);
    }
    if (byIndex.has(i)) {
      throw new Error(`Índice repetido en la clasificación: ${i}.`);
    }
    if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) {
      throw new Error(
        `Categoría inválida para el movimiento ${i}: "${category}".`,
      );
    }
    byIndex.set(i, category as MovementCategory);
  }
  if (byIndex.size !== totalMovements) {
    throw new Error(
      `La clasificación cubre ${byIndex.size} de ${totalMovements} movimientos.`,
    );
  }
  return byIndex;
}

/**
 * Aplica las categorías definitivas produciendo extractos NUEVOS (los
 * originales —el extractedData persistido— no se mutan).
 */
export function applyClassifications(
  statements: BankStatementExtraction[],
  byIndex: Map<number, MovementCategory>,
): AppliedClassification {
  let index = 0;
  let changedCount = 0;
  const reclassified = statements.map((s) => ({
    ...s,
    movements: s.movements.map((m) => {
      const category = byIndex.get(index++) ?? m.category;
      if (category !== m.category) changedCount++;
      return category === m.category ? m : { ...m, category };
    }),
  }));
  return {
    statements: reclassified,
    changedCount,
    totalMovements: index,
  };
}

export const countMovements = (statements: BankStatementExtraction[]): number =>
  statements.reduce((acc, s) => acc + s.movements.length, 0);
