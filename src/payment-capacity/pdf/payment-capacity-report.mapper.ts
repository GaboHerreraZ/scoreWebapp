// ─── View-model del PDF del estudio de CAPACIDAD DE PAGO ───────────────────
// Reusa el view-model del informe EEFF (veredicto, central, dimensiones,
// flags, alertas, narrativa — todo eso es idéntico) y lo especializa:
//  - keyFigures → cifras de capacidad (ingreso verificado, cuota máxima, DTI…)
//  - bloque `capacity` → serie de ingreso, obligaciones detectadas,
//    comportamiento y cobertura (la plantilla lo renderiza solo si existe)
// La plantilla es LA MISMA (credit-study-report.template.html), con secciones
// condicionadas a {{#if capacity}} que el flujo EEFF nunca ve.

import {
  buildReportViewModel,
  type StepsData,
  type CompanyHeader,
} from '../../credit-studies/pdf/credit-study-report.mapper.js';
import type { CapacityFigures } from '../engine/payment-capacity.engine.js';

const currencyFmt = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const money = (v: number | null | undefined) =>
  v == null ? '—' : currencyFmt.format(v);
const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(v * 100)}%`;

/** Bloques del step2 de capacidad que consume el PDF (subset). */
interface CapacityStep2 {
  coverage: {
    requiredMonths: number;
    coveredMonths: number;
    payrollStubs: number;
    contractorInvoices: number;
  } | null;
  analysis: {
    monthlyIncomeSeries: unknown;
    detectedObligations: unknown;
    behavior: unknown;
  } | null;
}

const OBLIGATION_KIND_LABEL: Record<string, string> = {
  loan: 'Cuota de crédito',
  card: 'Servicio de tarjeta',
  probable_installment: 'Obligación probable',
};

export function buildCapacityReportViewModel(
  steps: StepsData,
  company: CompanyHeader,
  generatedAt: string,
) {
  const base = buildReportViewModel(steps, company, generatedAt);

  const result = steps.step3?.result as
    | (NonNullable<StepsData['step3']>['result'] & {
        capacityFigures?: CapacityFigures;
      })
    | null
    | undefined;
  const cf = result?.capacityFigures ?? null;

  // Cifras de capacidad en el MISMO formato {label, value} que la plantilla
  // itera (reemplazan a las cifras EEFF, que aquí serían ceros sin sentido).
  const keyFigures = cf
    ? [
        {
          label: 'Ingreso mensual verificado',
          value: money(cf.verifiedMonthlyIncome),
        },
        ...(cf.payrollNetIncome != null
          ? [
              {
                label: 'Neto de nómina (desprendible)',
                value: money(cf.payrollNetIncome),
              },
            ]
          : []),
        {
          label: 'Ingreso según extractos',
          value: money(cf.bankStatementIncome),
        },
        ...(cf.incomeVerificationIndex != null
          ? [
              {
                label: 'Índice de verificación nómina-cuenta',
                value: pct(cf.incomeVerificationIndex),
              },
            ]
          : []),
        {
          label: 'Compromisos fijos mensuales',
          value: `${money(cf.recurringFixedExpenses)}/mes`,
        },
        {
          label: 'Cuotas de crédito',
          value: `${money(cf.debtServicePayments)}/mes`,
        },
        {
          label: 'Pago de tarjetas (no es cuota)',
          value: `${money(cf.cardPayments)}/mes`,
        },
        {
          label: 'Ingreso disponible',
          value: `${money(cf.availableIncome)}/mes`,
        },
        {
          label: 'Costo de vida observado (no resta)',
          value: `${money(cf.livingCost)}/mes`,
        },
        {
          label: 'Cuota máxima sostenible',
          value: `${money(cf.maxSuggestedInstallment)}/mes`,
        },
        ...(cf.minInstallmentsForRequested != null
          ? [
              {
                label: 'Cuotas mínimas para el monto solicitado',
                value: `${cf.minInstallmentsForRequested} (sin intereses)`,
              },
            ]
          : []),
        {
          label: 'Endeudamiento actual (sin tarjetas)',
          value: pct(cf.currentDti),
        },
        ...(cf.payrollLoanCapacity != null
          ? [
              {
                label: 'Cupo de libranza (Ley 1527)',
                value: money(cf.payrollLoanCapacity),
              },
            ]
          : []),
        { label: 'Variación del ingreso (CV)', value: pct(cf.incomeCv) },
        {
          label: 'Meses con ingreso',
          value: `${cf.monthsWithIncome} de ${cf.coveredMonths}`,
        },
      ]
    : [];

  // Detalle del step2 (serie, obligaciones, comportamiento, cobertura).
  const step2 = steps as unknown as { step2?: CapacityStep2 | null };
  const analysis = step2.step2?.analysis ?? null;
  const coverage = step2.step2?.coverage ?? null;
  // Divisor de todos los promedios de la tabla de obligaciones.
  const coveredMonths = coverage?.coveredMonths ?? cf?.coveredMonths ?? 0;

  const incomeSeries = Array.isArray(analysis?.monthlyIncomeSeries)
    ? (
        analysis.monthlyIncomeSeries as Array<{
          month: string;
          income: number;
          deposits: number;
        }>
      ).map((p) => ({
        month: p.month,
        income: money(p.income),
        deposits: p.deposits,
      }))
    : [];

  // Cada obligación se imprime con el TOTAL del período y su desglose mes a mes,
  // no solo con el promedio: el promedio es ese total dividido entre los meses
  // del extracto y por sí solo no se puede buscar en el PDF del banco.
  const obligations = Array.isArray(analysis?.detectedObligations)
    ? (
        analysis.detectedObligations as Array<{
          kind: string;
          counterparty: string;
          source?: string;
          totalAmount?: number;
          paymentCount?: number;
          monthlyTotals?: Array<{ month: string; amount: number }>;
          monthlyAverage: number;
          months?: string[];
          confidence: string;
        }>
      ).map((o) => ({
        counterparty: o.counterparty,
        kindLabel: OBLIGATION_KIND_LABEL[o.kind] ?? o.kind,
        total: money(o.totalAmount ?? o.monthlyAverage * (coveredMonths || 1)),
        monthlyAverage: money(o.monthlyAverage),
        breakdown: (o.monthlyTotals ?? [])
          .map((m) => `${m.month.slice(5)}: ${money(m.amount)}`)
          .join('  ·  '),
        payments:
          o.source === 'payrollStub'
            ? 'Descuento de nómina'
            : `${o.paymentCount ?? 0} pago(s) en ${o.months?.length ?? 0} de ${coveredMonths} mes(es)`,
        confidenceLabel: o.confidence === 'high' ? 'Alta' : 'Media',
        probable: o.kind === 'probable_installment',
      }))
    : [];

  const b = analysis?.behavior as Record<string, unknown> | null;
  const behaviorRows = b
    ? ([
        {
          label: 'Saldo promedio',
          value: money(b.averageBalance as number | null),
        },
        { label: 'Saldo mínimo', value: money(b.minBalance as number | null) },
        {
          label: 'Días con saldo negativo',
          value: String((b.daysNegative as number) ?? 0),
        },
        { label: 'Días en cero', value: String((b.daysAtZero as number) ?? 0) },
        {
          label: 'Retiro en las 48h tras el abono',
          value: pct(b.pctWithdrawn48h as number | null),
        },
        {
          label: 'Apuestas / ingreso',
          value: pct(b.gamblingPctOfIncome as number | null),
        },
      ] as Array<{ label: string; value: string }>)
    : [];

  const coverageLine = coverage
    ? `Extractos: ${coverage.coveredMonths} de ${coverage.requiredMonths} mes(es) requeridos · Desprendibles: ${coverage.payrollStubs} · Facturas: ${coverage.contractorInvoices}`
    : null;

  return {
    ...base,
    keyFigures,
    // La fuente del estudio de capacidad son los documentos verificados, no
    // "el PDF" a secas (label del flujo EEFF).
    source: {
      ...base.source,
      label: 'Extractos y comprobantes',
    },
    capacity: {
      employmentTypeLabel:
        cf?.employmentType === 'independent' ? 'Independiente' : 'Asalariado',
      paysOwnSocialSecurity: cf?.paysOwnSocialSecurity ?? false,
      verifiedHireDate: cf?.verifiedHireDate ?? null,
      coverageLine,
      incomeSeries,
      obligations,
      behaviorRows,
    },
  };
}
