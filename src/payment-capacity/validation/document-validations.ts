// ─── Validaciones determinísticas de los documentos (V1–V10) ───────────────
// Definidas en docs/estudio-persona-natural-extraccion.md (§2 y §5). Corren EN
// CÓDIGO, nunca en el prompt: la IA extrae, el código verifica. Si una
// validación de cuadre falla, la extracción está incompleta O el documento fue
// adulterado — el estudio corre igual pero la dimensión Veracidad lo castiga y
// el detalle queda declarado.
//
// V1  saldo corrido fila a fila            (extracto, intra-doc)
// V2  checksum del RESUMEN                 (extracto, intra-doc)
// V3  suma de movimientos vs totales       (extracto, intra-doc)
// V4  continuidad entre PDFs de una cuenta (extractos, cross-doc)
// V5  titular ≈ identidad del Customer     (todos, cross-doc)
// V6  fechas dentro del período            (extracto, intra-doc)
// V7  cuenta de depósito nómina = extracto (cross-doc; la más fuerte del set)
// V8  checksum del neto                    (nómina, intra-doc)
// V9  neto en letras = neto en número      (nómina, intra-doc)
// V10 conceptos espejo cuadran             (nómina, intra-doc)

import type {
  BankStatementExtraction,
  PayrollStubExtraction,
  ContractorInvoiceExtraction,
  ValidationOutcome,
} from '../extraction/extraction.types.js';
import { namesMatch } from './identity-match.js';
import { parseSpanishAmountWords } from '../../common/utils/number-words-es.js';

/** Tolerancia de centavos en cuadres (redondeos de intereses del banco). */
const CENTS_TOLERANCE = 1.0;
/** Tolerancia del cuadre de totales del resumen (suma de cientos de filas). */
const SUMMARY_TOLERANCE = 5.0;
/** Días de gracia en la contigüidad de períodos entre PDFs. */
const PERIOD_GAP_DAYS = 3;

const near = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance;

const money = (v: number) =>
  v.toLocaleString('es-CO', { maximumFractionDigits: 2 });

// ─── Extracto: V1, V2, V3, V6 ──────────────────────────────────────────────

export function validateBankStatementInternals(
  doc: BankStatementExtraction,
): ValidationOutcome[] {
  const outcomes: ValidationOutcome[] = [];
  const movements = doc.movements ?? [];

  // V1 — saldo corrido: balance[n-1] + amount[n] = balance[n].
  if (movements.length === 0) {
    outcomes.push({
      code: 'V1',
      label: 'Continuidad del saldo fila a fila',
      passed: null,
      severity: 'warning',
      detail: 'El extracto no tiene movimientos extraídos.',
    });
  } else {
    let breaks = 0;
    let firstBreakAt: string | null = null;
    for (let i = 1; i < movements.length; i++) {
      const expected = movements[i - 1].balance + movements[i].amount;
      if (!near(expected, movements[i].balance, CENTS_TOLERANCE)) {
        breaks += 1;
        firstBreakAt ??= `${movements[i].date} "${movements[i].rawDescription}"`;
      }
    }
    outcomes.push({
      code: 'V1',
      label: 'Continuidad del saldo fila a fila',
      passed: breaks === 0,
      severity: 'danger',
      detail:
        breaks === 0
          ? `Las ${movements.length} filas cuadran con el saldo corrido.`
          : `${breaks} fila(s) no cuadran con el saldo corrido (primera: ${firstBreakAt}). Extracción incompleta o documento alterado.`,
    });
  }

  // V2 — checksum del RESUMEN: anterior + abonos − cargos = actual.
  const s = doc.summary;
  if (
    s?.previousBalance != null &&
    s.totalCredits != null &&
    s.totalDebits != null &&
    s.finalBalance != null
  ) {
    const expected = s.previousBalance + s.totalCredits - s.totalDebits;
    const passed = near(expected, s.finalBalance, CENTS_TOLERANCE);
    outcomes.push({
      code: 'V2',
      label: 'Checksum del resumen del banco',
      passed,
      severity: 'danger',
      detail: passed
        ? 'Saldo anterior + abonos − cargos = saldo actual ✓'
        : `El resumen no cuadra: ${money(s.previousBalance)} + ${money(s.totalCredits)} − ${money(s.totalDebits)} = ${money(expected)} ≠ ${money(s.finalBalance)}.`,
    });
  } else {
    outcomes.push({
      code: 'V2',
      label: 'Checksum del resumen del banco',
      passed: null,
      severity: 'warning',
      detail: 'El extracto no trae el bloque de resumen completo.',
    });
  }

  // V3 — suma de abonos/cargos extraídos vs totales del resumen.
  if (
    movements.length > 0 &&
    s?.totalCredits != null &&
    s.totalDebits != null
  ) {
    let credits = 0;
    let debits = 0;
    for (const m of movements) {
      if (m.amount >= 0) credits += m.amount;
      else debits += -m.amount;
    }
    const creditsOk = near(credits, s.totalCredits, SUMMARY_TOLERANCE);
    const debitsOk = near(debits, s.totalDebits, SUMMARY_TOLERANCE);
    outcomes.push({
      code: 'V3',
      label: 'Suma de movimientos vs totales',
      passed: creditsOk && debitsOk,
      severity: 'danger',
      detail:
        creditsOk && debitsOk
          ? `Abonos ${money(credits)} y cargos ${money(debits)} cuadran contra el resumen.`
          : `Los movimientos extraídos no cuadran contra el resumen (abonos ${money(credits)} vs ${money(s.totalCredits)}; cargos ${money(debits)} vs ${money(s.totalDebits)}). Faltan o sobran movimientos.`,
    });
  }

  // V6 — todas las fechas dentro del período del encabezado.
  if (doc.period?.from && doc.period?.to && movements.length > 0) {
    const from = doc.period.from;
    const to = doc.period.to;
    const outOfRange = movements.filter((m) => m.date < from || m.date > to);
    outcomes.push({
      code: 'V6',
      label: 'Fechas dentro del período',
      passed: outOfRange.length === 0,
      severity: 'warning',
      detail:
        outOfRange.length === 0
          ? `Todos los movimientos caen dentro de ${from}..${to}.`
          : `${outOfRange.length} movimiento(s) fuera del período ${from}..${to} (¿páginas de otro extracto mezcladas?).`,
    });
  }

  return outcomes;
}

// ─── Extractos: V4 (continuidad entre PDFs de una misma cuenta) ────────────

export function validateSeriesContinuity(
  statements: BankStatementExtraction[],
): ValidationOutcome[] {
  const outcomes: ValidationOutcome[] = [];
  // Agrupar por cuenta (últimos 4 dígitos + banco); cada serie se valida sola.
  const byAccount = new Map<string, BankStatementExtraction[]>();
  for (const st of statements) {
    const key = `${st.account?.bank ?? '?'}·${st.account?.accountNumberLast4 ?? '?'}`;
    byAccount.set(key, [...(byAccount.get(key) ?? []), st]);
  }

  for (const [account, series] of byAccount) {
    if (series.length < 2) continue; // un solo PDF: la continuidad interna la cubre V1
    const sorted = [...series].sort((a, b) =>
      (a.period?.from ?? '').localeCompare(b.period?.from ?? ''),
    );
    const issues: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      // Contigüidad de períodos (con días de gracia).
      if (prev.period?.to && curr.period?.from) {
        const gapDays =
          (Date.parse(curr.period.from) - Date.parse(prev.period.to)) /
          86_400_000;
        if (gapDays > PERIOD_GAP_DAYS + 1 || gapDays < -PERIOD_GAP_DAYS) {
          issues.push(
            `salto de período entre ${prev.period.to} y ${curr.period.from}`,
          );
        }
      }
      // Saldo final = saldo inicial del siguiente.
      if (
        prev.summary?.finalBalance != null &&
        curr.summary?.previousBalance != null &&
        !near(
          prev.summary.finalBalance,
          curr.summary.previousBalance,
          CENTS_TOLERANCE,
        )
      ) {
        issues.push(
          `el saldo final ${money(prev.summary.finalBalance)} no coincide con el inicial ${money(curr.summary.previousBalance)} del siguiente`,
        );
      }
    }
    outcomes.push({
      code: 'V4',
      label: `Continuidad de la serie (${account})`,
      passed: issues.length === 0,
      severity: 'danger',
      detail:
        issues.length === 0
          ? `Los ${series.length} extractos de la cuenta son consecutivos y sus saldos empalman.`
          : `La serie no empalma: ${issues.join('; ')}. Extracto editado o meses de cuentas distintas.`,
    });
  }
  return outcomes;
}

// ─── V5 — identidad del titular en los documentos vs el Customer ───────────

export function validateIdentity(
  holders: Array<{ source: string; name: string | null }>,
  customerName: string,
): ValidationOutcome {
  const withName = holders.filter((h) => !!h.name?.trim());
  if (withName.length === 0) {
    return {
      code: 'V5',
      label: 'Identidad del titular en los documentos',
      passed: null,
      severity: 'warning',
      detail: 'Ningún documento trae el nombre del titular legible.',
    };
  }
  const mismatches = withName.filter((h) => !namesMatch(h.name!, customerName));
  return {
    code: 'V5',
    label: 'Identidad del titular en los documentos',
    passed: mismatches.length === 0,
    severity: 'danger',
    detail:
      mismatches.length === 0
        ? `El titular de ${withName.length} documento(s) coincide con la identidad consultada.`
        : `Titular distinto en: ${mismatches.map((m) => `${m.source} ("${m.name}")`).join(', ')} — ¿documentos de un tercero?`,
  };
}

// ─── V7 — cuenta de depósito de la nómina = cuenta del extracto ────────────

export function validateDepositAccountMatch(
  stubs: PayrollStubExtraction[],
  statements: BankStatementExtraction[],
): ValidationOutcome {
  const declared = stubs
    .map((p) => p.depositAccount?.accountNumberLast4)
    .filter((v): v is string => !!v);
  const statementAccounts = statements
    .map((st) => st.account?.accountNumberLast4)
    .filter((v): v is string => !!v);

  if (declared.length === 0 || statementAccounts.length === 0) {
    return {
      code: 'V7',
      label: 'Cuenta de depósito de la nómina',
      passed: null,
      severity: 'warning',
      detail:
        declared.length === 0
          ? 'El desprendible no declara la cuenta de depósito; no se puede cruzar.'
          : 'No se pudo leer el número de cuenta de los extractos.',
    };
  }
  const matched = declared.some((d) => statementAccounts.includes(d));
  return {
    code: 'V7',
    label: 'Cuenta de depósito de la nómina',
    passed: matched,
    severity: 'danger',
    detail: matched
      ? `La nómina se consigna en la cuenta ****${declared[0]}, que es la del extracto aportado ✓ (la validación anti-fraude más fuerte del set).`
      : `La nómina declara la cuenta ****${declared.join(', ****')} pero los extractos son de ****${statementAccounts.join(', ****')}: el extracto aportado NO es donde cae el salario.`,
  };
}

// ─── Nómina: V8, V9, V10 ───────────────────────────────────────────────────

export function validatePayrollStub(
  stub: PayrollStubExtraction,
): ValidationOutcome[] {
  const outcomes: ValidationOutcome[] = [];

  // V8 — devengos − deducciones = neto (los tres impresos en el documento).
  if (
    stub.totals?.earnings != null &&
    stub.totals?.deductions != null &&
    stub.netPay != null
  ) {
    const expected = stub.totals.earnings - stub.totals.deductions;
    const passed = near(expected, stub.netPay, CENTS_TOLERANCE);
    outcomes.push({
      code: 'V8',
      label: 'Checksum del neto de la nómina',
      passed,
      severity: 'danger',
      detail: passed
        ? `${money(stub.totals.earnings)} − ${money(stub.totals.deductions)} = ${money(stub.netPay)} ✓`
        : `El neto no cuadra: ${money(stub.totals.earnings)} − ${money(stub.totals.deductions)} = ${money(expected)} ≠ ${money(stub.netPay)}.`,
    });
  } else {
    outcomes.push({
      code: 'V8',
      label: 'Checksum del neto de la nómina',
      passed: null,
      severity: 'warning',
      detail: 'El desprendible no trae totales y neto legibles.',
    });
  }

  // V9 — neto en letras = neto en número.
  if (stub.netPayInWords && stub.netPay != null) {
    const parsed = parseSpanishAmountWords(stub.netPayInWords);
    if (parsed === null) {
      outcomes.push({
        code: 'V9',
        label: 'Neto en letras vs neto en número',
        passed: null,
        severity: 'info',
        detail: 'El monto en letras no pudo interpretarse automáticamente.',
      });
    } else {
      const passed = near(parsed, Math.round(stub.netPay), CENTS_TOLERANCE);
      outcomes.push({
        code: 'V9',
        label: 'Neto en letras vs neto en número',
        passed,
        severity: 'danger',
        detail: passed
          ? `"${stub.netPayInWords.slice(0, 60)}…" = ${money(parsed)} ✓`
          : `El neto en letras (${money(parsed)}) no coincide con el neto en número (${money(stub.netPay)}): dos representaciones que un editor descuidado no cambia juntas.`,
      });
    }
  }

  // V10 — conceptos espejo (beneficio flexible como devengo Y deducción por el
  // mismo valor): se detectan y se declaran — el módulo de indicadores los
  // netea para no inflar deducciones ni comerse cupo de libranza falso.
  const earnings = stub.concepts?.filter((c) => (c.earning ?? 0) > 0) ?? [];
  const deductions = stub.concepts?.filter((c) => (c.deduction ?? 0) > 0) ?? [];
  const mirrors: string[] = [];
  const usedDeductions = new Set<number>();
  for (const e of earnings) {
    const idx = deductions.findIndex(
      (d, i) => !usedDeductions.has(i) && d.deduction === e.earning,
    );
    if (idx >= 0) {
      usedDeductions.add(idx);
      mirrors.push(
        `${e.concept} ↔ ${deductions[idx].concept} (${money(e.earning!)})`,
      );
    }
  }
  outcomes.push({
    code: 'V10',
    label: 'Conceptos espejo (beneficios flexibles)',
    passed: true,
    severity: 'info',
    detail:
      mirrors.length === 0
        ? 'Sin beneficios flexibles espejo detectados.'
        : `Detectados y neteados: ${mirrors.join('; ')}.`,
  });

  return outcomes;
}

// ─── Factura de contratista: consistencia mínima intra-doc ─────────────────
// (No hay checksum bancario; se valida que los renglones sumen el total.)

export function validateContractorInvoice(
  invoice: ContractorInvoiceExtraction,
): ValidationOutcome[] {
  if (!invoice.lineItems?.length || invoice.total == null) return [];
  const sum = invoice.lineItems.reduce((acc, li) => acc + (li.amount ?? 0), 0);
  const passed = near(sum, invoice.total, 0.02);
  return [
    {
      code: 'V8', // mismo espíritu de checksum, reportado bajo V8 para la factura
      label: 'Checksum del total de la factura',
      passed,
      severity: 'warning',
      detail: passed
        ? `Los renglones suman el total (${invoice.currency} ${money(invoice.total)}) ✓`
        : `Los renglones suman ${money(sum)} pero el total impreso es ${money(invoice.total)}.`,
    },
  ];
}
