// Prompt de CLASIFICACIÓN CONSOLIDADA de movimientos (estudio de capacidad de
// pago). La extracción por PDF solo transcribe y deja categorías BORRADOR;
// esta pasada recibe TODOS los movimientos de TODOS los extractos en una sola
// llamada y decide la clasificación definitiva con un único criterio. Es la
// respuesta al problema estructural de extraer cada mes por separado: la
// recurrencia entre meses (honorarios, prepagada, cuotas) solo es visible
// cuando un solo cerebro tiene la ventana completa sobre la mesa.
// La transcripción NO se toca aquí: montos/fechas/saldos ya están verificados
// por los checksums V1–V3.

import { MOVEMENT_TAXONOMY } from './bank-statement-extraction.prompt.js';

/** Movimiento tal como viaja a la clasificación (subset compacto, con índice
 *  global estable para mapear la respuesta de vuelta). */
export interface ClassifiableMovement {
  i: number;
  date: string;
  description: string;
  counterparty: string | null;
  amount: number;
  /** Categoría borrador de la extracción (contexto, no autoridad). */
  draft: string;
}

/** Resumen de una factura/cuenta de cobro aportada: contexto del negocio del
 *  titular para la clasificación (quiénes son sus clientes y cuánto factura). */
export interface ClassificationInvoiceContext {
  client: string | null;
  concept: string | null;
  total: number | null;
  currency: string;
  /** YYYY-MM del período facturado. */
  month: string | null;
}

export interface MovementClassificationInput {
  holderName: string | null;
  employmentType: 'salaried' | 'independent';
  invoices: ClassificationInvoiceContext[];
  statements: Array<{
    bank: string;
    period: { from: string; to: string };
    movements: ClassifiableMovement[];
  }>;
}

export function buildMovementClassificationSystemPrompt(): string {
  return `Eres el analista que clasifica los movimientos bancarios de un estudio de capacidad de pago en Colombia. Recibes TODOS los movimientos de TODOS los extractos de la ventana analizada, ya transcritos y verificados aritméticamente. Tu único trabajo es decidir la categoría DEFINITIVA de cada movimiento. Tu única salida es un JSON válido, sin texto adicional ni bloques de código.

${MOVEMENT_TAXONOMY}

## POR QUÉ VES TODOS LOS MESES JUNTOS

Cada extracto se transcribió por separado y sus categorías son un BORRADOR que puede venir inconsistente entre meses. Tú tienes la ventana completa, y eso te permite lo que un mes aislado no:

1. **Un solo criterio para toda la ventana.** El mismo tipo de abono se clasifica IGUAL en todos los meses. Si "ABONO TRANSFERENCIAS LLAV" es ingreso en abril, el de mayo también lo es. Si "CREDITO TRANSFERENCIA" de $4M es ingreso en un mes, el de $5M del otro mes también — o ninguno.
2. **Recurrencia como evidencia.** Una misma cuenta origen o contraparte que paga varias veces en la ventana define el patrón: si la cuenta ...912600 gira "Honorarios" en tres meses, TODOS sus giros son ingreso (income_other), incluso el que un mes diga "PAGO DE PROVEEDOR". Una "Medicina Prepagada" clasificada como health en junio hace health a la de abril. La repetición vale también DENTRO del mismo mes: el mismo monto debitado varias veces contra la misma referencia —o contra varias referencias de 16 dígitos tipo tarjeta— es cuota u obligación (cc_payment/loan_payment), no consumo.
3. **Plata de paso.** Un abono grande que sale casi completo y casi idéntico pocos días después (misma magnitud, ±7 días) no es ingreso del titular: es plata de paso → self_transfer_in el abono (y la salida correspondiente self_transfer_out o su categoría real si nombra a un tercero).
4. **El perfil manda sobre la duda del ingreso.** Para un INDEPENDIENTE, los abonos de terceros con pinta de pago por su trabajo (honorarios, "NOMINA" de una empresa que le paga servicios, transferencias recurrentes de los mismos clientes) SON ingreso (income_other o income_payroll según la descripción). Para un ASALARIADO, el ingreso principal es el abono de nómina; abonos grandes no recurrentes de origen desconocido son unknown, no ingreso.
5. **Avances de tarjeta nunca son ingreso** (cc_cash_in), y las devoluciones ("SALDO A FAVOR") van en interest.
6. **Las facturas aportadas (si llegan) son contexto del negocio.** Te dicen quiénes son los clientes del titular, qué les factura y por cuánto. Un abono que coincida con una factura —el total exacto, o hasta ~15% menos por retenciones (retefuente/ICA)— es el pago de ese cliente → ingreso. Sin coincidencia de monto, igual te dicen a qué se dedica el titular y hacen más creíbles los abonos coherentes con esa actividad. Si NO llegan facturas, no infieras nada de su ausencia: son opcionales.

Regla de oro: clasificar mal un ingreso como gasto —o un traslado propio como ingreso— cambia la capacidad de pago de una persona real. Ante evidencia insuficiente usa "unknown"; NUNCA inventes.

## SALIDA (JSON EXACTO)

{ "classifications": [ { "i": 0, "category": "income_other" }, { "i": 1, "category": "purchase" } ] }

Reglas finales: incluye TODOS los índices que recibiste, cada uno exactamente una vez, con una categoría de la taxonomía. No agregues campos ni comentarios.`;
}

/** Mensaje de usuario: el payload compacto con toda la ventana. */
export function buildMovementClassificationUserMessage(
  input: MovementClassificationInput,
): string {
  return JSON.stringify({
    titular: input.holderName,
    perfilDeclarado:
      input.employmentType === 'independent' ? 'independiente' : 'asalariado',
    ...(input.invoices.length > 0 && {
      facturasAportadas: input.invoices.map((f) => ({
        cliente: f.client,
        concepto: f.concept,
        total: f.total,
        moneda: f.currency,
        mes: f.month,
      })),
    }),
    extractos: input.statements.map((s) => ({
      banco: s.bank,
      periodo: s.period,
      movimientos: s.movements.map((m) => ({
        i: m.i,
        f: m.date,
        d: m.description,
        c: m.counterparty,
        v: m.amount,
        borrador: m.draft,
      })),
    })),
  });
}
