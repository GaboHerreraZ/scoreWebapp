import { scoreToBand } from '../../scoring/scoring.constants.js';

/**
 * Mapper: respuesta de `getSteps` → view-model plano y PRE-FORMATEADO que
 * consume la plantilla Handlebars del PDF (credit-study-report.template.html).
 *
 * La plantilla es "tonta": no formatea ni decide colores. TODO se calcula aquí,
 * replicando 1:1 la lógica del front:
 *   - status/veredicto  → study-result.ts (statusConfig)
 *   - dimensiones       → study-result.ts (getDimensionStatusConfig / fillRatio)
 *   - alertas del scoring→ study-result.ts (alertGroups)
 *   - central de riesgo → central-risk.ts (paymentBehaviorConfig, linkNetworkRows,
 *                         selfAlerts/linkedAlerts, formatBehaviorMonth)
 *
 * Ante cualquier cambio de esa lógica en el front, ESTE archivo es el espejo a
 * actualizar para que PDF y pantalla no se desincronicen.
 */

// ─── Tipos de entrada (subconjunto de lo que devuelve getSteps que usa el PDF) ─

interface CodeLabel {
  code: string | null;
  label: string | null;
}

interface RiskAlert {
  count: number | null;
  source: string | null;
  message: string | null;
  subject: string | null;
  identification: string | null;
}

interface LinkNode {
  name: string | null;
  documentType: string | null;
  documentNumber: string | null;
  alertCount: number | null;
  linkType: string | null;
  linkTypeLabel: string | null;
  children: LinkNode[] | null;
}

interface CentralRiskInput {
  consultedAt: Date | string | null;
  score: number | null;
  hasAlertas: boolean;
  alerts: RiskAlert[] | null;
  viabilidad: CodeLabel | null;
  ratingRecaudos: CodeLabel | null;
  nivelRiesgo: CodeLabel | null;
  ratingSectorial: CodeLabel | null;
  indebtedness: {
    saldoActual: number | null;
    porcentajeDeuda: number | null;
    saldoMora: number | null;
    montoSugerido: number | null;
  } | null;
  income: {
    reportedIncome: number | null;
    quotaToIncomePct: number | null;
  } | null;
  paymentBehavior:
    | { anioMes: string; comportamiento: string; comportamientoLabel: string }[]
    | null;
  creditSectors:
    | {
        sector: string | null;
        sectorLabel: string | null;
        creditosVigentes: string | null;
        creditosCerrados: string | null;
        saldoActual: string | null;
        saldoMora: string | null;
        porcentajeDeuda: string | null;
      }[]
    | null;
  creditPortfolio:
    | {
        tipoCredito: string | null;
        tipoCreditoLabel: string | null;
        saldo: string | null;
        porcentajePart: string | null;
      }[]
    | null;
  linkNetwork: LinkNode | null;
  // Checklist de verificación sugerido por la central ([{title, items[]}]).
  suggestions: { title: string | null; items: string[] | null }[] | null;
}

interface ScoringDimension {
  label: string;
  weight: number;
  contribution: number;
  evaluable: boolean;
}

/** Red flag del resultado (misma forma en las dos capas: PDF y central). */
interface RedFlag {
  severity: 'danger' | 'warning' | 'info';
  category: string | null;
  categoryLabel: string | null;
  title: string | null;
  detail: string | null;
}

interface ScoringResult {
  summary: {
    totalScore: number;
    maxScore: number;
    status: string;
    calculationSource: string;
    financialsVerified: boolean;
  };
  dimensions: Record<string, ScoringDimension>;
  approvedCreditLine: {
    amount: number;
    requested: number;
    cappedByBureau: boolean;
  } | null;
  reference: { experianSuggestedAmount: number | null } | null;
  alerts: { type: string; message: string }[];
  keyFigures: Record<string, number | null> | null;
  /** Capa 1: fiabilidad del PDF (el documento contra sí mismo). Opcional: resultados viejos no la traen. */
  pdfReliabilityFlags?: RedFlag[] | null;
  /** Capa 2: red flags derivadas de la central de riesgo. Opcional: resultados viejos no la traen. */
  centralRiskFlags?: RedFlag[] | null;
}

interface Step3Input {
  viabilityScore: number | null;
  viabilityStatus: string | null;
  recommendedCreditLine: number | null;
  recommendedTerm: number | null;
  resolutionDate: Date | string | null;
  result: ScoringResult;
  aiAnalysis: {
    result: string;
    model: string | null;
    createdAt: Date | string | null;
  } | null;
}

export interface StepsData {
  request: {
    requestedTerm: number | null;
    requestedCreditLine: number | null;
  } | null;
  step1: {
    customer: {
      businessName: string | null;
      identificationNumber: string | null;
      verificationDigit: string | null;
    } | null;
    centralRisk: CentralRiskInput | null;
  } | null;
  step3: Step3Input | null;
}

export interface CompanyHeader {
  name: string | null;
  nit: string | null;
  city: string | null;
}

// ─── Helpers de formato (los mismos criterios del front, en el backend) ───────

const currencyFmt = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

/** Convierte string/number de la central a número; null si vacío o inválido. */
function toNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

function formatCurrency(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return n == null ? '—' : currencyFmt.format(n);
}

function formatPercent(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return n == null
    ? '—'
    : `${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })}%`;
}

function formatCount(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return n == null ? '0' : n.toLocaleString('es-CO');
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

function formatTerm(months: number | null | undefined): string {
  return months == null ? '—' : `${months} ${months === 1 ? 'mes' : 'meses'}`;
}

// ─── Réplicas de la lógica de presentación del front ──────────────────────────

/** statusConfig del front: título + descripción + clase de pill por estado. */
function statusView(key: string) {
  switch (key) {
    case 'approved':
      return {
        key,
        pillClass: 'green',
        title: 'Viable',
        description:
          'El análisis indica que el cliente es apto para el cupo solicitado. La decisión final de otorgamiento es de su empresa.',
      };
    case 'conditional':
      return {
        key,
        pillClass: 'amber',
        title: 'Viable con condiciones',
        description:
          'El cliente es apto sujeto a las condiciones señaladas. Revíselas antes de otorgar el cupo.',
      };
    case 'rejected':
      return {
        key,
        pillClass: 'red',
        title: 'No viable',
        description:
          'El análisis no respalda el cupo solicitado bajo las condiciones actuales.',
      };
    default:
      return {
        key: 'pending',
        pillClass: 'gray',
        title: 'Pendiente',
        description: 'El estudio aún no ha sido procesado.',
      };
  }
}

/** Etiqueta corta de la fuente del cálculo (calculationSourceLabel del front). */
function sourceLabel(calculationSource: string | undefined): string | null {
  switch (calculationSource) {
    case 'datacredito':
      return 'Central de riesgo';
    case 'pdf':
      return 'Documento cargado';
    case 'none':
      return 'Sin datos';
    default:
      return null;
  }
}

/** Severidad del chip de comportamiento mensual (paymentBehaviorConfig del front). */
function paymentSeverity(code: string): 'ok' | 'warn' | 'none' | 'bad' {
  const c = (code ?? '').toUpperCase();
  if (c === 'N' || c === '0') return 'ok';
  if (c === '1') return 'warn';
  if (c === '' || c === '-' || c === 'S') return 'none';
  return 'bad';
}

/** MM/AA a partir de 'YYYY-MM' (formatBehaviorMonth del front). */
function behaviorMonth(anioMes: string): string {
  if (!anioMes) return '—';
  const [year, month] = anioMes.split('-');
  return month && year ? `${month}/${year.slice(-2)}` : anioMes;
}

/** Nivel/label/ancho de barra de una dimensión (getDimensionStatusConfig del front). */
function dimensionView(dim: ScoringDimension) {
  const ratio =
    dim.weight > 0
      ? Math.max(0, Math.min(1, dim.contribution / dim.weight))
      : 0;
  const level = ratio >= 0.8 ? 'good' : ratio >= 0.5 ? 'mid' : 'low';
  const statusLabel =
    ratio >= 0.8 ? 'Excelente' : ratio >= 0.5 ? 'Aceptable' : 'Crítico';
  return {
    label: dim.label,
    weight: dim.weight,
    fillPct: Math.round(ratio * 100),
    level,
    statusLabel,
  };
}

const ALERT_GROUP_META: Record<string, string> = {
  danger: 'Críticas',
  warning: 'Advertencias',
  info: 'Informativas',
  success: 'Favorables',
};

/**
 * Agrupa red flags por severidad (groupBySeverity del front) para las dos capas:
 * fiabilidad del PDF y señales de la central. El chip de categoría usa el label
 * legible (categoryLabel) con fallback al código.
 */
function buildFlagGroups(flags: RedFlag[] | null | undefined) {
  return (['danger', 'warning', 'info'] as const)
    .map((severity) => ({
      severity,
      label: ALERT_GROUP_META[severity],
      flags: (flags ?? [])
        .filter((f) => f.severity === severity)
        .map((f) => ({
          severity,
          title: f.title ?? '—',
          category: f.categoryLabel ?? f.category ?? null,
          detail: f.detail ?? null,
        })),
    }))
    .filter((g) => g.flags.length > 0);
}

// ─── Central de riesgo → bloque de la plantilla ───────────────────────────────

function buildCentralRisk(cr: CentralRiskInput | null) {
  if (!cr) return null;

  // Score de la central (150-950) con su banda — la MISMA tabla que usa la
  // Dim 7 del motor (scoreToBand), para que PDF y análisis nunca diverjan.
  let score: { value: string; bandLabel: string; pillClass: string } | null =
    null;
  if (cr.score != null) {
    const band = scoreToBand(cr.score);
    score = {
      value: cr.score.toLocaleString('es-CO'),
      bandLabel: band.label,
      pillClass:
        band.ratio >= 0.8 ? 'green' : band.ratio >= 0.4 ? 'amber' : 'red',
    };
  }

  const alerts = cr.alerts ?? [];
  const selfAlerts = alerts
    .filter((a) => a.source === 'self')
    .map((a) => ({
      subject: a.subject,
      count: a.count,
      message: a.message,
      identification: a.identification,
    }));
  const linkedAlerts = alerts
    .filter((a) => a.source === 'linked')
    .map((a) => ({
      subject: a.subject,
      count: a.count,
      message: a.message,
      identification: a.identification,
    }));

  // Calificaciones cualitativas: PN (viabilidad/recaudos) + PJ (nivel/sectorial).
  // Solo se incluyen las que traen label.
  const ratings = [
    { label: 'Viabilidad', value: cr.viabilidad?.label },
    { label: 'Recaudos', value: cr.ratingRecaudos?.label },
    { label: 'Nivel de riesgo', value: cr.nivelRiesgo?.label },
    { label: 'Calificación sectorial', value: cr.ratingSectorial?.label },
  ]
    .filter((r): r is { label: string; value: string } => !!r.value)
    .map((r) => ({ label: r.label, value: r.value }));

  const indebtedness = cr.indebtedness
    ? {
        saldoActual: formatCurrency(cr.indebtedness.saldoActual),
        porcentajeDeuda: formatPercent(cr.indebtedness.porcentajeDeuda),
        saldoMora: formatCurrency(cr.indebtedness.saldoMora),
        montoSugerido: formatCurrency(cr.indebtedness.montoSugerido),
      }
    : null;

  const income = cr.income
    ? {
        reportedIncome: formatCurrency(cr.income.reportedIncome),
        quotaToIncomePct: formatPercent(cr.income.quotaToIncomePct),
      }
    : null;

  const creditPortfolio = (cr.creditPortfolio ?? []).map((p) => ({
    tipoCredito: p.tipoCreditoLabel ?? p.tipoCredito ?? '—',
    saldo: formatCurrency(p.saldo),
    porcentajePart: formatPercent(p.porcentajePart),
  }));

  const paymentBehavior = (cr.paymentBehavior ?? []).map((p) => ({
    code: p.comportamiento || '-',
    sev: paymentSeverity(p.comportamiento),
    month: behaviorMonth(p.anioMes),
  }));

  const creditSectors = (cr.creditSectors ?? []).map((s) => ({
    sector: s.sectorLabel ?? s.sector ?? '—',
    creditosVigentes: formatCount(s.creditosVigentes),
    creditosCerrados: formatCount(s.creditosCerrados),
    saldoActual: formatCurrency(s.saldoActual),
    saldoMora: formatCurrency(s.saldoMora),
    porcentajeDeuda: formatPercent(s.porcentajeDeuda),
  }));

  // Red de vínculos aplanada por DFS, con profundidad → indentación (linkNetworkRows).
  const linkNetwork: {
    name: string;
    document: string;
    linkTypeLabel: string | null;
    alertCount: number | null;
    indentPx: number;
  }[] = [];
  const walk = (node: LinkNode, depth: number) => {
    const doc = [node.documentType, node.documentNumber]
      .filter(Boolean)
      .join(' ');
    linkNetwork.push({
      name: node.name ?? '—',
      document: doc || '—',
      linkTypeLabel: node.linkTypeLabel ?? node.linkType ?? null,
      alertCount: node.alertCount || null,
      indentPx: depth * 16,
    });
    (node.children ?? []).forEach((child) => walk(child, depth + 1));
  };
  if (cr.linkNetwork) walk(cr.linkNetwork, 0);

  // Checklist de verificación sugerido por la central (guía para el analista).
  const suggestions = (cr.suggestions ?? [])
    .map((s) => ({
      title: s.title,
      items: (s.items ?? []).filter((i) => !!i),
    }))
    .filter((s) => s.title || s.items.length > 0);

  return {
    consultedAt: cr.consultedAt ? formatDate(cr.consultedAt) : null,
    score,
    hasAlertas: cr.hasAlertas,
    selfAlerts,
    linkedAlerts,
    ratings,
    indebtedness,
    income,
    creditPortfolio,
    paymentBehavior,
    creditSectors,
    linkNetwork,
    suggestions,
  };
}

// ─── Cifras financieras clave (keyFigureRows del front) ───────────────────────

const KEY_FIGURE_ROWS: {
  key: string;
  label: string;
  format: 'currency' | 'days' | 'ratio';
}[] = [
  {
    key: 'monthlyPaymentCapacity',
    label: 'Capacidad de pago mensual',
    format: 'currency',
  },
  {
    key: 'paymentAtMaturity',
    label: 'Pago único al vencimiento',
    format: 'currency',
  },
  {
    key: 'capacityInTerm',
    label: 'Capacidad acumulada en el plazo',
    format: 'currency',
  },
  {
    key: 'annualPaymentCapacity',
    label: 'Capacidad de pago anual',
    format: 'currency',
  },
  { key: 'ebitda', label: 'EBITDA', format: 'currency' },
  {
    key: 'currentDebtService',
    label: 'Servicio de deuda actual',
    format: 'currency',
  },
  { key: 'paymentCoverageRatio', label: 'Cobertura de pago', format: 'ratio' },
  { key: 'stabilityFactor', label: 'Factor de estabilidad', format: 'ratio' },
  {
    key: 'accountsReceivableTurnover',
    label: 'Rotación de cartera',
    format: 'days',
  },
  { key: 'inventoryTurnover', label: 'Rotación de inventario', format: 'days' },
  { key: 'paymentTimeSuppliers', label: 'Pago a proveedores', format: 'days' },
  {
    key: 'cashConversionCycle',
    label: 'Ciclo de conversión de caja',
    format: 'days',
  },
];

function formatKeyFigure(
  value: number,
  format: 'currency' | 'days' | 'ratio',
): string {
  switch (format) {
    case 'currency':
      return currencyFmt.format(value);
    case 'days':
      return `${Math.round(value).toLocaleString('es-CO')} días`;
    case 'ratio':
      return value.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }
}

// ─── Entrada principal ────────────────────────────────────────────────────────

/**
 * Construye el objeto que rellena la plantilla del PDF. `generatedAt` se pasa
 * desde el servicio (ya formateado) para no depender de Date dentro del mapper.
 */
export function buildReportViewModel(
  steps: StepsData,
  company: CompanyHeader,
  generatedAt: string,
) {
  const step3 = steps.step3;
  const result = step3?.result ?? null;
  const summary = result?.summary ?? null;

  const customer = steps.step1?.customer ?? null;
  const identificationNumber = customer?.verificationDigit
    ? `${customer?.identificationNumber ?? ''}-${customer.verificationDigit}`
    : (customer?.identificationNumber ?? '—');

  const statusKey = summary?.status ?? step3?.viabilityStatus ?? 'pending';
  const status = statusView(statusKey);

  const label = sourceLabel(summary?.calculationSource);
  const source = {
    label,
    verified: summary?.financialsVerified ?? false,
    hasVerification: !!summary && summary.calculationSource !== 'none',
  };

  const requestedAmount =
    result?.approvedCreditLine?.requested ??
    steps.request?.requestedCreditLine ??
    null;
  const approvedAmount =
    result?.approvedCreditLine?.amount ?? step3?.recommendedCreditLine ?? null;
  const requestedTerm =
    steps.request?.requestedTerm ?? step3?.recommendedTerm ?? null;
  const bureauSuggestedAmount =
    result?.reference?.experianSuggestedAmount ?? null;

  const keyFigures = result?.keyFigures
    ? KEY_FIGURE_ROWS.filter((row) => result.keyFigures![row.key] != null).map(
        (row) => ({
          label: row.label,
          value: formatKeyFigure(result.keyFigures![row.key]!, row.format),
        }),
      )
    : [];

  const dimensions = result?.dimensions
    ? Object.values(result.dimensions)
        .filter((d) => d.evaluable)
        .map(dimensionView)
    : [];

  const alertGroups = result?.alerts
    ? (['danger', 'warning', 'info', 'success'] as const)
        .map((type) => ({
          type,
          label: ALERT_GROUP_META[type],
          messages: result.alerts
            .filter((a) => a.type === type)
            .map((a) => a.message),
        }))
        .filter((g) => g.messages.length > 0)
    : [];

  const aiAnalysis =
    step3?.aiAnalysis && step3.aiAnalysis.result?.trim()
      ? {
          result: step3.aiAnalysis.result,
          model: step3.aiAnalysis.model ?? '—',
          createdAt: formatDate(step3.aiAnalysis.createdAt),
        }
      : null;

  return {
    company: {
      name: company.name ?? '—',
      nit: company.nit ?? '—',
      city: company.city ?? '—',
    },
    customer: {
      businessName: customer?.businessName ?? '—',
      identificationNumber,
    },
    generatedAt,
    request: {
      resolutionDate: step3?.resolutionDate
        ? formatDate(step3.resolutionDate)
        : null,
      requestedAmount: formatCurrency(requestedAmount),
      approvedAmount: formatCurrency(approvedAmount),
      requestedTerm: formatTerm(requestedTerm),
      bureauSuggestedAmount:
        bureauSuggestedAmount != null
          ? formatCurrency(bureauSuggestedAmount)
          : null,
    },
    status,
    score: {
      value: summary?.totalScore ?? step3?.viabilityScore ?? 0,
      max: summary?.maxScore ?? 100,
    },
    source,
    cappedByBureau: result?.approvedCreditLine?.cappedByBureau ?? false,
    keyFigures,
    centralRisk: buildCentralRisk(steps.step1?.centralRisk ?? null),
    dimensions,
    // Dos capas de red flags (mismo orden y agrupación que el front).
    pdfReliabilityFlags: buildFlagGroups(result?.pdfReliabilityFlags),
    pdfReliabilityCount: (result?.pdfReliabilityFlags ?? []).length,
    centralRiskFlags: buildFlagGroups(result?.centralRiskFlags),
    centralRiskFlagCount: (result?.centralRiskFlags ?? []).length,
    alertGroups,
    aiAnalysis,
  };
}
