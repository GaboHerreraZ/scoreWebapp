// View-model del informe de la consulta de riesgo: todo pre-formateado para la
// plantilla (la plantilla no calcula nada). Marca propia + atribución de fuente.

interface CompanyHeader {
  name: string | null;
  nit: string | null;
  city: string | null;
}

interface DetailShape {
  studyDate: Date | null;
  requestedCreditLine: number | null;
  customer: {
    businessName: string | null;
    identificationNumber: string | null;
    identificationType?: { code: string | null; label: string | null } | null;
    nationality?: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    ageRange?: string | null;
    documentStatus: string | null;
    lastConsultedAt: Date | null;
  } | null;
  identity?: {
    typedName: string | null;
    centralName: string | null;
    matches: boolean | null;
  } | null;
  analysis: {
    summary: string | null;
    riskLevel: string | null;
    redFlags: unknown;
    positiveSignals: unknown;
    sections: unknown;
    keyFigures: unknown;
    amountComparison: unknown;
    recommendations?: unknown;
    createdAt: Date;
  } | null;
}

const RISK_LEVELS: Record<
  string,
  { label: string; color: string; background: string }
> = {
  low: { label: 'Riesgo bajo', color: '#166534', background: '#f0fdf4' },
  medium: { label: 'Riesgo medio', color: '#92400e', background: '#fffbeb' },
  high: { label: 'Riesgo alto', color: '#991b1b', background: '#fef2f2' },
};

const TIMELINE_COLORS: Record<string, string> = {
  ok: '#22c55e',
  delay: '#f59e0b',
  severe: '#dc2626',
  unknown: '#d1d5db',
};

const fmtMoney = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v)
    ? `$${Math.round(v).toLocaleString('es-CO')}`
    : '—';

const fmtPct = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${v}%` : '—';

const fmtDate = (v: Date | string | null | undefined): string =>
  v
    ? new Intl.DateTimeFormat('es-CO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(new Date(v))
    : '—';

export function buildBureauCheckReportViewModel(
  detail: DetailShape,
  company: CompanyHeader,
  generatedAt: string,
) {
  const a = detail.analysis!;
  const risk = RISK_LEVELS[a.riskLevel ?? ''] ?? {
    label: 'Sin nivel',
    color: '#374151',
    background: '#f9fafb',
  };

  const kf = (a.keyFigures ?? {}) as Record<string, unknown>;
  const cmp = (a.amountComparison ?? {}) as Record<string, unknown>;
  const sections = (a.sections ?? {}) as Record<string, unknown>;
  const flags = (Array.isArray(a.redFlags) ? a.redFlags : []) as Array<{
    severity?: string;
    title?: string;
    detail?: string;
  }>;
  const signals = (
    Array.isArray(a.positiveSignals) ? a.positiveSignals : []
  ) as Array<{ title?: string; detail?: string }>;
  const recommendations = (
    Array.isArray(a.recommendations) ? a.recommendations : []
  ) as Array<{ title?: string; detail?: string }>;
  const sectorActivity = (
    Array.isArray(kf.sectorActivity) ? kf.sectorActivity : []
  ) as Array<Record<string, unknown>>;
  const timeline = (
    Array.isArray(kf.paymentTimeline) ? kf.paymentTimeline : []
  ) as Array<Record<string, unknown>>;
  const stats = (kf.paymentStats ?? null) as Record<string, unknown> | null;
  const trend = (kf.balanceTrend ?? null) as Record<string, unknown> | null;
  const alertsDetail = (
    Array.isArray(kf.alertsDetail) ? kf.alertsDetail : []
  ) as Array<Record<string, unknown>>;

  const identity = detail.identity ?? null;
  const docTypeLabel = detail.customer?.identificationType?.label ?? null;

  const numberOrDash = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';

  return {
    generatedAt,
    company,
    titular: {
      name: detail.customer?.businessName ?? '—',
      identification: detail.customer?.identificationNumber ?? '—',
      documentType: docTypeLabel,
      nationality: detail.customer?.nationality ?? null,
      ageRange: detail.customer?.ageRange ?? null,
      city: detail.customer?.city ?? '—',
      state: detail.customer?.state ?? null,
      documentStatus: detail.customer?.documentStatus ?? null,
      consultedAt: fmtDate(detail.customer?.lastConsultedAt ?? null),
    },
    // Verificación de identidad: solo se pinta cuando el match es concluyente.
    identity:
      identity && identity.matches !== null
        ? {
            matches: identity.matches,
            label: identity.matches
              ? 'El nombre digitado coincide con el registrado en la central.'
              : `Revisar identidad: se digitó "${identity.typedName ?? ''}" y la central registra "${identity.centralName ?? ''}".`,
          }
        : null,
    risk: { ...risk, level: a.riskLevel },
    probability: typeof kf.txtProbabilidad === 'string' ? kf.txtProbabilidad : null,
    summary: a.summary ?? '',
    keyFigures: [
      { label: 'Saldo total de obligaciones', value: fmtMoney(kf.saldoActual) },
      { label: 'Saldo en mora', value: fmtMoney(kf.saldoMora) },
      { label: '% de endeudamiento', value: fmtPct(kf.porcentajeDeuda) },
      { label: 'Cuota mensual comprometida', value: fmtMoney(kf.valorCuota) },
      {
        label: 'Obligaciones como codeudor',
        value: fmtMoney(kf.totalCodeudorOtros),
      },
      {
        label: 'Ingreso mensual reportado',
        value: fmtMoney(kf.reportedIncome),
      },
      {
        label: 'Ingreso comprometido en cuotas',
        value: fmtPct(kf.quotaToIncomePct),
      },
      { label: 'Créditos vigentes', value: numberOrDash(kf.creditosVigentes) },
      { label: 'Créditos cerrados', value: numberOrDash(kf.creditosCerrados) },
    ],
    amountComparison: {
      requested: fmtMoney(cmp.requested),
      suggested: fmtMoney(cmp.suggested),
      verdictLabel:
        typeof cmp.verdictLabel === 'string' ? cmp.verdictLabel : '—',
      hasData: cmp.verdict !== 'not_comparable',
    },
    sectorActivity: sectorActivity.map((s) => ({
      sector: typeof s.sector === 'string' ? s.sector : 'Sector',
      vigentes: numberOrDash(s.vigentes),
      cerrados: numberOrDash(s.cerrados),
      saldoActual: fmtMoney(s.saldoActual),
      saldoMora: fmtMoney(s.saldoMora),
      cuota: fmtMoney(s.valorCuota),
    })),
    paymentTimeline: timeline.map((p) => ({
      month: typeof p.month === 'string' ? p.month : '',
      color:
        TIMELINE_COLORS[typeof p.status === 'string' ? p.status : 'unknown'] ??
        TIMELINE_COLORS.unknown,
      title: typeof p.label === 'string' ? p.label : '',
    })),
    paymentStats: stats
      ? {
          monthsWithData: numberOrDash(stats.monthsWithData),
          onTimePct: fmtPct(stats.onTimePct),
          delayMonths: numberOrDash(stats.delayMonths),
          worstLabel:
            typeof stats.worstLabel === 'string' ? stats.worstLabel : null,
          lastDelayMonth:
            typeof stats.lastDelayMonth === 'string'
              ? stats.lastDelayMonth
              : null,
        }
      : null,
    balanceTrendLabel: typeof trend?.label === 'string' ? trend.label : null,
    alerts: alertsDetail.map((al) => ({
      message: typeof al.message === 'string' ? al.message : '',
      date: typeof al.date === 'string' ? al.date : null,
    })),
    redFlags: flags.map((f) => ({
      isDanger: f.severity === 'danger',
      severityLabel: f.severity === 'danger' ? 'Seria' : 'A vigilar',
      title: f.title ?? '',
      detail: f.detail ?? '',
    })),
    positiveSignals: signals.map((s) => ({
      title: s.title ?? '',
      detail: s.detail ?? '',
    })),
    recommendations: recommendations.map((r) => ({
      title: r.title ?? '',
      detail: r.detail ?? '',
    })),
    sections: [
      { title: 'Endeudamiento', text: sections.indebtedness ?? '' },
      { title: 'Hábito de pago', text: sections.paymentHabits ?? '' },
      { title: 'Alertas y verificación', text: sections.alerts ?? '' },
      { title: 'Ingreso', text: sections.income ?? '' },
    ].filter((s) => s.text),
    analysisDate: fmtDate(a.createdAt),
  };
}
