// ─── Indicadores del estudio de capacidad de pago (§4 del diseño) ──────────
// Módulo PURO (sin IO, sin Nest), análogo a financial-indicators del flujo
// EEFF: recibe las extracciones normalizadas y produce los indicadores que se
// persisten en PaymentCapacityAnalysis y alimentan el engine de scoring.
// Referencias: docs/estudio-persona-natural-diseno.md §4 y
// docs/estudio-persona-natural-extraccion.md §3, §5 y §6.

import type {
  BankStatementExtraction,
  ContractorInvoiceExtraction,
  PayrollStubExtraction,
  ReliabilityFlag,
} from '../extraction/extraction.types.js';
import { isPayrollPeriodCurrent, monthsInRange } from '../coverage.js';
import {
  behaviorSignals,
  detectObligations,
  livingCostMonthly,
  monthKey,
  monthlyIncomeSeries,
  recurringFixedExpensesMonthly,
  seriesStats,
  type BehaviorSignals,
  type DetectedObligation,
  type MonthlyIncomePoint,
} from './movement-recurrence.js';
import {
  CARD_PAYMENT_REVIEW_PCT,
  DTI_CRITICAL,
  FX_PLAUSIBLE_MAX,
  FX_PLAUSIBLE_MIN,
  GAMBLING_DANGER_PCT,
  GAMBLING_WARNING_PCT,
  INVOICE_FX_TOLERANCE,
  INVOICE_RETENTION_TOLERANCE,
  MAX_INSTALLMENT_AVAILABLE_PCT,
  MAX_INSTALLMENT_NET_PCT,
  VERIFICATION_INDEX_FLAG,
  WINDOW_MONTHS_INDEPENDENT,
  WINDOW_MONTHS_SALARIED,
} from '../engine/payment-capacity.constants.js';

// ─── Clasificación de conceptos del desprendible (doc de extracción §5) ────

export interface PayrollBreakdown {
  /** Devengos salariales recurrentes (sin espejos ni estacionales). */
  salaryEarnings: number;
  /** Prima/vacaciones: no proyectables como ingreso mensual. */
  seasonalEarnings: number;
  /** Salud, pensión, solidaridad, retefuente (base del cupo Ley 1527). */
  statutoryDeductions: number;
  /** Deuda por descuento directo: consume cupo de libranza. */
  libranzaDeductions: number;
  /** Embargos: la respuesta documental a "¿está embargado?". */
  garnishmentDeductions: number;
  otherDeductions: number;
  /** Beneficios flexibles espejo neteados (devengo = deducción). */
  mirroredAmount: number;
  netAverage: number;
}

const money = (v: number) => Math.round(v).toLocaleString('es-CO');

const SEASONAL_RE = /\b(PRIMA|VACACION|AGUINALDO)\w*/i;
const STATUTORY_RE = /SALUD|PENSI[OÓ]N|SOLIDARIDAD|RETENCI[OÓ]N|RETEFUENTE/i;
const LIBRANZA_RE = /LIBRANZA/i;
const GARNISHMENT_RE = /EMBARGO/i;

/**
 * Clasifica y agrega los conceptos de los desprendibles. Los espejos (mismo
 * valor como devengo Y deducción — beneficio flexible) se netean de ambos
 * lados: contarlos inflaría el endeudamiento y comería cupo de libranza falso.
 */
export function classifyPayrollConcepts(
  stubs: PayrollStubExtraction[],
): PayrollBreakdown | null {
  if (stubs.length === 0) return null;

  const acc: PayrollBreakdown = {
    salaryEarnings: 0,
    seasonalEarnings: 0,
    statutoryDeductions: 0,
    libranzaDeductions: 0,
    garnishmentDeductions: 0,
    otherDeductions: 0,
    mirroredAmount: 0,
    netAverage: 0,
  };

  for (const stub of stubs) {
    const earnings = stub.concepts.filter((c) => (c.earning ?? 0) > 0);
    const deductions = stub.concepts.filter((c) => (c.deduction ?? 0) > 0);

    // Espejos: mismo mecanismo que la validación V10.
    const mirroredDeductionIdx = new Set<number>();
    const mirroredEarnings = new Set<(typeof earnings)[number]>();
    for (const e of earnings) {
      const idx = deductions.findIndex(
        (d, i) => !mirroredDeductionIdx.has(i) && d.deduction === e.earning,
      );
      if (idx >= 0) {
        mirroredDeductionIdx.add(idx);
        mirroredEarnings.add(e);
        acc.mirroredAmount += e.earning ?? 0;
      }
    }

    for (const e of earnings) {
      if (mirroredEarnings.has(e)) continue;
      if (SEASONAL_RE.test(e.concept)) acc.seasonalEarnings += e.earning ?? 0;
      else acc.salaryEarnings += e.earning ?? 0;
    }
    deductions.forEach((d, i) => {
      if (mirroredDeductionIdx.has(i)) return;
      const amount = d.deduction ?? 0;
      if (GARNISHMENT_RE.test(d.concept)) acc.garnishmentDeductions += amount;
      else if (LIBRANZA_RE.test(d.concept)) acc.libranzaDeductions += amount;
      else if (STATUTORY_RE.test(d.concept)) acc.statutoryDeductions += amount;
      else acc.otherDeductions += amount;
    });
    acc.netAverage += stub.netPay ?? 0;
  }

  // Promedios por desprendible (2 desprendibles = 2 meses de nómina).
  const n = stubs.length;
  acc.salaryEarnings /= n;
  acc.seasonalEarnings /= n;
  acc.statutoryDeductions /= n;
  acc.libranzaDeductions /= n;
  acc.garnishmentDeductions /= n;
  acc.otherDeductions /= n;
  acc.mirroredAmount /= n;
  acc.netAverage /= n;
  return acc;
}

// ─── Verificación factura ↔ abono internacional (doc de extracción §4) ─────

export interface InvoiceCheck {
  invoiceNumber: string | null;
  month: string | null;
  currency: string;
  invoiceTotal: number | null;
  creditInMonth: number;
  /** COP: abono ÷ total. USD: TRM implícita (abono ÷ total). */
  impliedRate: number | null;
  plausible: boolean | null;
  /** La factura es de un mes que los extractos no cubren: no se puede cruzar. */
  outOfWindow: boolean;
  detail: string;
}

function checkInvoicesAgainstStatements(
  invoices: ContractorInvoiceExtraction[],
  statements: BankStatementExtraction[],
): InvoiceCheck[] {
  const intlByMonth = new Map<string, number>();
  const creditsByMonth = new Map<string, number[]>();
  const windowMonths = new Set<string>();
  for (const st of statements) {
    for (const wm of monthsInRange(st.period.from, st.period.to)) {
      windowMonths.add(wm);
    }
    for (const mv of st.movements) {
      if (mv.amount <= 0) continue;
      const key = monthKey(mv.date);
      if (mv.category === 'income_international') {
        intlByMonth.set(key, (intlByMonth.get(key) ?? 0) + mv.amount);
      }
      // Candidatos COP: cualquier abono real (los intereses y avances de TC no
      // pueden ser el pago de una factura).
      if (mv.category !== 'interest' && mv.category !== 'cc_cash_in') {
        const list = creditsByMonth.get(key) ?? [];
        list.push(mv.amount);
        creditsByMonth.set(key, list);
      }
    }
  }

  return invoices.map((inv) => {
    const month = (inv.period?.from ?? inv.issueDate)?.slice(0, 7) ?? null;
    if (!month || inv.total == null || inv.total === 0) {
      return {
        invoiceNumber: inv.invoiceNumber,
        month,
        currency: inv.currency,
        invoiceTotal: inv.total,
        creditInMonth: 0,
        impliedRate: null,
        plausible: null,
        outOfWindow: false,
        detail: 'Factura sin período o sin total: no se puede cruzar.',
      };
    }
    // El pago puede caer en el mes del período o en el siguiente.
    const [y, m] = month.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);

    // Fuera de la ventana de extractos: el abono no PODÍA aparecer. No es una
    // inconsistencia, es una imposibilidad — se reporta como tal, sin warning.
    if (!windowMonths.has(month) && !windowMonths.has(nextMonth)) {
      return {
        invoiceNumber: inv.invoiceNumber,
        month,
        currency: inv.currency,
        invoiceTotal: inv.total,
        creditInMonth: 0,
        impliedRate: null,
        plausible: null,
        outOfWindow: true,
        detail: `La factura es de ${month} y los extractos no cubren ese mes ni el siguiente: el abono no puede cruzarse contra la cuenta.`,
      };
    }

    if (inv.currency === 'COP') {
      // Un cliente local paga por transferencia/ACH: se busca UN abono que
      // corresponda al total (hasta -15% por retefuente/ICA, +10% tolerancia).
      const candidates = [
        ...(creditsByMonth.get(month) ?? []),
        ...(creditsByMonth.get(nextMonth) ?? []),
      ];
      const match =
        candidates
          .filter(
            (a) =>
              a >= inv.total! * (1 - INVOICE_RETENTION_TOLERANCE) &&
              a <= inv.total! * (1 + INVOICE_FX_TOLERANCE),
          )
          .sort(
            (a, b) => Math.abs(a - inv.total!) - Math.abs(b - inv.total!),
          )[0] ?? null;
      return {
        invoiceNumber: inv.invoiceNumber,
        month,
        currency: inv.currency,
        invoiceTotal: inv.total,
        creditInMonth: match ?? 0,
        impliedRate: match !== null ? match / inv.total : null,
        plausible: match !== null,
        outOfWindow: false,
        detail:
          match !== null
            ? `Abono de ${match.toLocaleString('es-CO')} en el extracto corresponde al total facturado (${inv.total.toLocaleString('es-CO')}).`
            : `Ningún abono de ${month} (ni de ${nextMonth}) corresponde al total facturado (${inv.total.toLocaleString('es-CO')}, con margen por retenciones).`,
      };
    }

    // Moneda extranjera: TRM implícita dentro de la banda plausible ± tolerancia
    // (v1 sin API de TRM; la banda absorbe la TRM del día + fees de plataforma).
    const credit = intlByMonth.get(month) ?? intlByMonth.get(nextMonth) ?? 0;
    const impliedRate = credit > 0 ? credit / inv.total : null;
    const min = FX_PLAUSIBLE_MIN * (1 - INVOICE_FX_TOLERANCE);
    const max = FX_PLAUSIBLE_MAX * (1 + INVOICE_FX_TOLERANCE);
    const plausible =
      impliedRate !== null && impliedRate >= min && impliedRate <= max;
    return {
      invoiceNumber: inv.invoiceNumber,
      month,
      currency: inv.currency,
      invoiceTotal: inv.total,
      creditInMonth: credit,
      impliedRate,
      plausible,
      outOfWindow: false,
      detail:
        impliedRate === null
          ? `Sin abono internacional en ${month}: la factura no se refleja en el extracto.`
          : plausible
            ? `TRM implícita ${Math.round(impliedRate).toLocaleString('es-CO')} dentro de la banda plausible ✓`
            : `TRM implícita ${Math.round(impliedRate).toLocaleString('es-CO')} fuera de la banda ${min.toLocaleString('es-CO')}–${max.toLocaleString('es-CO')}: el abono no corresponde a la factura.`,
    };
  });
}

// ─── Cálculo principal ─────────────────────────────────────────────────────

export interface PaymentCapacityIndicatorsInput {
  employmentType: 'salaried' | 'independent';
  statements: BankStatementExtraction[];
  payrollStubs: PayrollStubExtraction[];
  contractorInvoices: ContractorInvoiceExtraction[];
  /** Fecha declarada de inicio laboral (ISO), fallback de la verificada. */
  declaredEmploymentStartDate?: string | null;
}

export interface PaymentCapacityIndicatorsResult {
  verifiedMonthlyIncome: number;
  payrollNetIncome: number | null;
  bankStatementIncome: number;
  incomeVerificationIndex: number | null;
  incomeCv: number | null;
  monthsWithIncome: number;
  windowMonths: number;
  coveredMonths: number;
  paysOwnSocialSecurity: boolean;
  verifiedHireDate: string | null;
  hireDateSource: 'payrollStub' | 'declared' | null;
  /** Compromisos contractuales mensuales (arriendo, salud, educación,
   *  servicios, telecom, seguros, suscripciones). NO incluye costo de vida. */
  recurringFixedExpenses: number;
  /** Todo lo que sale por obligaciones: cuotas + tarjeta. Resta del disponible. */
  existingDebtPayments: number;
  /** Servicio de deuda comprometido (sin tarjeta): numerador del DTI. */
  debtServicePayments: number;
  /** Pagos a tarjeta de crédito: salen de la cuenta, pero no son cuota. */
  cardPayments: number;
  /** Costo de vida observado (mercado, transporte, compras, retiros). Se
   *  reporta; NO resta del disponible (lo protege el tope del 30%). */
  livingCost: number;
  availableIncome: number;
  maxSuggestedInstallment: number;
  payrollLoanCapacity: number | null;
  currentDti: number | null;
  behavior: BehaviorSignals;
  monthlyIncomeSeries: MonthlyIncomePoint[];
  detectedObligations: DetectedObligation[];
  invoiceChecks: InvoiceCheck[];
  payroll: PayrollBreakdown | null;
  /** Flags que los propios indicadores producen (se suman a los de extracción). */
  indicatorFlags: ReliabilityFlag[];
}

export function computePaymentCapacityIndicators(
  input: PaymentCapacityIndicatorsInput,
): PaymentCapacityIndicatorsResult {
  const flags: ReliabilityFlag[] = [];
  const windowMonths =
    input.employmentType === 'independent'
      ? WINDOW_MONTHS_INDEPENDENT
      : WINDOW_MONTHS_SALARIED;

  // Meses cubiertos por los extractos (unión; un PDF puede traer un trimestre).
  const monthSet = new Set<string>();
  for (const st of input.statements) {
    for (const m of monthsInRange(st.period.from, st.period.to)) {
      monthSet.add(m);
    }
  }
  const months = [...monthSet].sort();
  const allMovements = input.statements.flatMap((s) => s.movements);

  // ── Ingreso (§4.1) ──
  const series = monthlyIncomeSeries(allMovements, months);
  const { mean: bankStatementIncome, cv: incomeCv } = seriesStats(
    series.map((p) => p.income),
  );
  const monthsWithIncome = series.filter((p) => p.income > 0).length;

  const payroll = classifyPayrollConcepts(input.payrollStubs);
  const payrollNetIncome = payroll ? payroll.netAverage : null;

  // ¿El desprendible corresponde a la ventana analizada? Uno de un período muy
  // anterior no prueba el ingreso de HOY (ni sirve para cruzarlo contra la
  // cuenta): deja de mandar sobre el ingreso y manda el extracto, que sí está
  // validado aritméticamente. Se acepta el mes inmediatamente anterior al
  // primero, por el desfase natural entre corte de nómina y de extracto.
  const datedStubPeriods = input.payrollStubs
    .map((s) => s.period)
    .filter((p): p is string => !!p && /^\d{4}-\d{2}$/.test(p));
  const payrollIsCurrent =
    datedStubPeriods.length === 0 ||
    datedStubPeriods.some((p) => isPayrollPeriodCurrent(p, months));

  if (!payrollIsCurrent) {
    flags.push({
      severity: 'danger',
      category: 'consistency',
      title: 'Desprendible fuera del período analizado',
      detail: `El desprendible corresponde a ${datedStubPeriods.join(', ')} y los extractos cubren ${months[0]} a ${months[months.length - 1]}: no acredita el ingreso actual. El ingreso se tomó de los abonos verificados en la cuenta.`,
    });
  }

  // Índice de verificación (asalariado): abono de nómina detectado ÷ neto
  // del desprendible. Sin abonos income_payroll no hay contraste — flag.
  // Con un desprendible desactualizado no se calcula: compararía el neto de
  // otro período contra los abonos de hoy.
  let incomeVerificationIndex: number | null = null;
  if (
    input.employmentType === 'salaried' &&
    payrollNetIncome &&
    payrollIsCurrent
  ) {
    const payrollByMonth = new Map<string, number>();
    for (const mv of allMovements) {
      if (mv.amount > 0 && mv.category === 'income_payroll') {
        const key = monthKey(mv.date);
        payrollByMonth.set(key, (payrollByMonth.get(key) ?? 0) + mv.amount);
      }
    }
    const monthlyPayroll = [...payrollByMonth.values()];
    if (monthlyPayroll.length > 0) {
      const avgDetected =
        monthlyPayroll.reduce((a, b) => a + b, 0) / monthlyPayroll.length;
      incomeVerificationIndex = avgDetected / payrollNetIncome;
      if (incomeVerificationIndex < VERIFICATION_INDEX_FLAG) {
        flags.push({
          severity: 'danger',
          category: 'income',
          title: 'El ingreso declarado no es el que llega a la cuenta',
          detail: `El abono de nómina detectado en el extracto es el ${Math.round(incomeVerificationIndex * 100)}% del neto del desprendible (umbral: ${VERIFICATION_INDEX_FLAG * 100}%).`,
        });
      }
    } else {
      flags.push({
        severity: 'warning',
        category: 'income',
        title: 'Abono de nómina no detectado en el extracto',
        detail: `Ningún movimiento del extracto se identificó como pago de nómina, así que el neto del desprendible ($${money(payrollNetIncome)}) no se pudo contrastar contra la cuenta. El ingreso se tomó de los abonos verificados en el extracto${bankStatementIncome > 0 ? ` ($${money(bankStatementIncome)}/mes)` : ''}: es la misma cuenta sobre la que se miden los egresos. Verifique el origen de esos abonos.`,
      });
    }
  }

  // Facturas del independiente ↔ abonos internacionales.
  const invoiceChecks = checkInvoicesAgainstStatements(
    input.contractorInvoices,
    input.statements,
  );
  for (const check of invoiceChecks) {
    if (check.plausible === false) {
      flags.push({
        severity: 'warning',
        category: 'income',
        title: `Factura ${check.invoiceNumber ?? 's/n'} sin respaldo en el extracto`,
        detail: check.detail,
      });
    } else if (check.outOfWindow) {
      flags.push({
        severity: 'info',
        category: 'income',
        title: `Factura ${check.invoiceNumber ?? 's/n'} fuera de la ventana de extractos`,
        detail: check.detail,
      });
    }
  }

  // Ingreso verificado. El asalariado parte del neto de nómina, pero el papel
  // solo manda si está vigente Y la cuenta no lo desmiente:
  //  - índice por debajo del umbral → manda lo que LLEGA a la cuenta;
  //  - sin abono de nómina identificado → manda el extracto (ver abajo);
  //  - desprendible fuera del período → manda el extracto.
  // El independiente siempre parte del ingreso del extracto.
  let verifiedMonthlyIncome: number;
  if (
    input.employmentType === 'salaried' &&
    payrollNetIncome &&
    payrollIsCurrent
  ) {
    if (incomeVerificationIndex !== null) {
      verifiedMonthlyIncome =
        incomeVerificationIndex < VERIFICATION_INDEX_FLAG
          ? payrollNetIncome * incomeVerificationIndex
          : payrollNetIncome;
    } else {
      // Sin abono de nómina identificado, el desprendible y el extracto no
      // están mirando la misma plata: no hay nada que contrastar. Los egresos
      // (cuotas, tarjetas, gastos fijos) se miden TODOS sobre la cuenta, así
      // que el ingreso también tiene que salir de ahí — está validado
      // aritméticamente por V1–V3, y el desprendible queda como cifra
      // declarada. Antes se tomaba el menor de los dos: cuando la cuenta
      // recibía más que el desprendible eso mezclaba fuentes y dejaba el
      // disponible en negativo a titulares cuya cuenta es visiblemente
      // solvente. El caso contrario no cambia: si la cuenta recibe menos, el
      // menor ES el extracto.
      verifiedMonthlyIncome =
        bankStatementIncome > 0 ? bankStatementIncome : payrollNetIncome;
    }
  } else {
    verifiedMonthlyIncome = bankStatementIncome;
  }

  // Desprendible de jun/dic con prima o vacaciones: ingreso no proyectable.
  if (payroll && payroll.seasonalEarnings > 0) {
    const seasonalPeriods = input.payrollStubs
      .map((s) => s.period)
      .filter((p): p is string => !!p && /-(06|12)$/.test(p));
    if (seasonalPeriods.length > 0) {
      flags.push({
        severity: 'warning',
        category: 'income',
        title: 'Desprendible con conceptos estacionales',
        detail: `El desprendible de ${seasonalPeriods.join(', ')} incluye prima/vacaciones: el neto de ese mes no es proyectable como ingreso mensual.`,
      });
    }
  }

  // Antigüedad: la Fecha de Ingreso del desprendible es VERIFICADA; la
  // declarada es fallback y se contrasta.
  const stubHireDate =
    input.payrollStubs.map((s) => s.hireDate).find((d) => !!d) ?? null;
  const verifiedHireDate =
    stubHireDate ?? input.declaredEmploymentStartDate ?? null;
  const hireDateSource: 'payrollStub' | 'declared' | null = stubHireDate
    ? 'payrollStub'
    : input.declaredEmploymentStartDate
      ? 'declared'
      : null;
  // La declarada se pide solo como mes y año aproximados: el umbral es de un
  // año para no alertar por memoria imprecisa, pero una diferencia mayor sí es
  // señal (declarar 2014 con un desprendible que dice 2024 no es un olvido).
  if (
    stubHireDate &&
    input.declaredEmploymentStartDate &&
    Math.abs(
      Date.parse(stubHireDate) - Date.parse(input.declaredEmploymentStartDate),
    ) >
      365 * 86_400_000
  ) {
    const years =
      Math.abs(
        Date.parse(stubHireDate) -
          Date.parse(input.declaredEmploymentStartDate),
      ) /
      (365 * 86_400_000);
    flags.push({
      severity: 'warning',
      category: 'consistency',
      title: 'Antigüedad declarada vs verificada',
      detail: `La antigüedad declarada (${input.declaredEmploymentStartDate.slice(0, 7)}) difiere en ${Math.floor(years)} año(s) de la fecha de ingreso del desprendible (${stubHireDate}). Manda la del desprendible.`,
    });
  }

  const paysOwnSocialSecurity = allMovements.some(
    (m) => m.amount < 0 && m.category === 'social_security',
  );

  // A un asalariado formal el empleador le descuenta la seguridad social: verla
  // salir de su cuenta apunta a que el perfil declarado no corresponde.
  if (input.employmentType === 'salaried' && paysOwnSocialSecurity) {
    flags.push({
      severity: 'warning',
      category: 'consistency',
      title: 'Perfil declarado vs evidencia de la cuenta',
      detail:
        'Se declaró perfil asalariado, pero la cuenta muestra pagos de seguridad social hechos por el titular: en una nómina formal los asume el empleador. Verifica si en realidad es independiente.',
    });
  }

  // ── Capacidad (§4.2) ──
  const recurringFixedExpenses = recurringFixedExpensesMonthly(
    allMovements,
    months.length,
  );
  const obligations = detectObligations(allMovements, months);

  // Libranzas y embargos del desprendible: obligaciones ciertas que el
  // extracto no muestra (salen antes de la consignación). Sin desglose mensual
  // porque su fuente no es la cuenta: el desprendible ya las da al mes.
  const fromStub = (
    counterparty: string,
    amount: number,
    detail: string,
  ): DetectedObligation => ({
    kind: 'loan',
    counterparty,
    source: 'payrollStub',
    totalAmount: amount,
    paymentCount: input.payrollStubs.length,
    monthlyTotals: [],
    monthlyAverage: amount,
    months: [],
    confidence: 'high',
    detail,
  });
  if (payroll && payroll.libranzaDeductions > 0) {
    obligations.push(
      fromStub(
        'LIBRANZA (desprendible)',
        payroll.libranzaDeductions,
        'Descuento directo de nómina: no aparece en el extracto porque se descuenta antes de la consignación. La cifra ya es mensual.',
      ),
    );
  }
  if (payroll && payroll.garnishmentDeductions > 0) {
    obligations.push(
      fromStub(
        'EMBARGO (desprendible)',
        payroll.garnishmentDeductions,
        'Embargo judicial descontado por nómina: no aparece en el extracto porque se descuenta antes de la consignación. La cifra ya es mensual.',
      ),
    );
  }

  // Todo lo que sale por obligaciones resta del disponible: la plata se va,
  // sea cuota o consumo de tarjeta.
  const existingDebtPayments = obligations.reduce(
    (a, o) => a + o.monthlyAverage,
    0,
  );
  // El pago de tarjeta se separa: sale de la cuenta (resta del disponible) pero
  // NO es servicio de deuda comprometido. Quien paga la tarjeta COMPLETA cada
  // mes está moviendo su consumo, no amortizando; el extracto no distingue el
  // pago mínimo del total. Contarlo en el DTI declara sobreendeudado a quien
  // usa la tarjeta como medio de pago.
  const cardPayments = obligations
    .filter((o) => o.kind === 'card')
    .reduce((a, o) => a + o.monthlyAverage, 0);
  const debtServicePayments = existingDebtPayments - cardPayments;
  const availableIncome =
    verifiedMonthlyIncome - recurringFixedExpenses - existingDebtPayments;
  const livingCost = livingCostMonthly(allMovements, months.length);
  const maxSuggestedInstallment = Math.max(
    Math.min(
      MAX_INSTALLMENT_NET_PCT * verifiedMonthlyIncome,
      MAX_INSTALLMENT_AVAILABLE_PCT * availableIncome,
    ),
    0,
  );

  // Cupo de libranza (Ley 1527): 50% × (devengos salariales − descuentos de
  // ley) − (libranzas + embargos existentes). Con un desprendible fuera del
  // período el salario base está desactualizado: no se emite la cifra.
  const payrollLoanCapacity =
    payroll && payrollIsCurrent
      ? Math.max(
          0.5 * (payroll.salaryEarnings - payroll.statutoryDeductions) -
            (payroll.libranzaDeductions + payroll.garnishmentDeductions),
          0,
        )
      : null;

  // ── Endeudamiento (§4.3) ──
  // DTI = servicio de deuda COMPROMETIDO ÷ ingreso. Sin la tarjeta: ver arriba.
  const currentDti =
    verifiedMonthlyIncome > 0
      ? debtServicePayments / verifiedMonthlyIncome
      : null;
  // No hay DTI proyectado: el estudio no pide plazo, así que no existe una
  // cuota del crédito nuevo con la cual proyectar. Se marca el endeudamiento
  // que YA tiene, que es un hecho verificado y no una hipótesis.
  if (currentDti !== null && currentDti > DTI_CRITICAL) {
    flags.push({
      severity: 'danger',
      category: 'indebtedness',
      title: 'Endeudamiento actual crítico',
      detail: `Las cuotas de crédito que ya paga toman el ${Math.round(currentDti * 100)}% del ingreso verificado (umbral crítico: ${DTI_CRITICAL * 100}%). No incluye el pago de tarjetas.`,
    });
  }
  // Una tarjeta que se lleva más de la mitad del ingreso merece revisión aunque
  // no se cuente como deuda: o es consumo desbordado, o es cuota disfrazada.
  if (
    verifiedMonthlyIncome > 0 &&
    cardPayments / verifiedMonthlyIncome > CARD_PAYMENT_REVIEW_PCT
  ) {
    flags.push({
      severity: 'warning',
      category: 'indebtedness',
      title: 'El pago de tarjetas se lleva buena parte del ingreso',
      detail: `Los pagos a tarjeta de crédito promedian ${Math.round((cardPayments / verifiedMonthlyIncome) * 100)}% del ingreso verificado. No se contaron como cuota de deuda porque el extracto no distingue el pago mínimo del pago total, pero sí salen de la cuenta: confirme con el titular cuánto de eso es cuota obligatoria.`,
    });
  }

  // ── Comportamiento (§4.4) ──
  const behavior = behaviorSignals(
    input.statements,
    verifiedMonthlyIncome,
    months.length,
  );
  if (behavior.gamblingPctOfIncome !== null) {
    if (behavior.gamblingPctOfIncome > GAMBLING_DANGER_PCT) {
      flags.push({
        severity: 'danger',
        category: 'behavior',
        title: 'Apuestas en línea por encima del umbral crítico',
        detail: `Las apuestas toman el ${Math.round(behavior.gamblingPctOfIncome * 100)}% del ingreso mensual (umbral: ${GAMBLING_DANGER_PCT * 100}%).`,
      });
    } else if (behavior.gamblingPctOfIncome > GAMBLING_WARNING_PCT) {
      flags.push({
        severity: 'warning',
        category: 'behavior',
        title: 'Apuestas en línea recurrentes',
        detail: `Las apuestas toman el ${Math.round(behavior.gamblingPctOfIncome * 100)}% del ingreso mensual (umbral de atención: ${GAMBLING_WARNING_PCT * 100}%).`,
      });
    }
  }
  if (behavior.walletTransfersCount > 0) {
    flags.push({
      severity: 'info',
      category: 'behavior',
      title: 'Transferencias a billetera digital',
      detail: `${behavior.walletTransfersCount} transferencia(s) a billetera (≈ ${Math.round(behavior.walletTransfersMonthlyAvg).toLocaleString('es-CO')}/mes): ese bolsillo no es visible sin el extracto de la billetera.`,
    });
  }
  if (behavior.cardCashInTotal > 0) {
    flags.push({
      severity: 'warning',
      category: 'behavior',
      title: 'Avances de tarjeta de crédito hacia la cuenta',
      detail: `Se detectaron ${Math.round(behavior.cardCashInTotal).toLocaleString('es-CO')} en avances de TC: no son ingreso y señalan estrés de liquidez.`,
    });
  }

  return {
    verifiedMonthlyIncome,
    payrollNetIncome,
    bankStatementIncome,
    incomeVerificationIndex,
    incomeCv,
    monthsWithIncome,
    windowMonths,
    coveredMonths: months.length,
    paysOwnSocialSecurity,
    verifiedHireDate,
    hireDateSource,
    recurringFixedExpenses,
    existingDebtPayments,
    debtServicePayments,
    cardPayments,
    livingCost,
    availableIncome,
    maxSuggestedInstallment,
    payrollLoanCapacity,
    currentDti,
    behavior,
    monthlyIncomeSeries: series,
    detectedObligations: obligations,
    invoiceChecks,
    payroll,
    indicatorFlags: flags,
  };
}
