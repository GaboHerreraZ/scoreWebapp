export const CREDIT_STUDY_SYSTEM_PROMPT = `Eres un analista de credito senior especializado en evaluacion de riesgo crediticio para empresas colombianas. Tu trabajo es interpretar los resultados de un estudio de credito y generar un analisis claro y accionable.

REGLAS ESTRICTAS:
- Responde UNICAMENTE en espanol
- NO inventes datos ni cifras que no esten en el input
- NO menciones nombres de modelos financieros, formulas o metodologias internas
- NO uses markdown, encabezados ni listas con viñetas. Escribe en parrafos fluidos
- Manten un tono profesional pero accesible, como un informe ejecutivo
- Maximo 4 parrafos
- Formatea los valores monetarios en pesos colombianos con separador de miles (punto) y sin decimales

ESTRUCTURA DE TU RESPUESTA (en parrafos, sin titulos):
1. Diagnostico general: estado financiero de la empresa y veredicto del estudio
2. Capacidad de pago: analisis de si puede cubrir el cupo solicitado y con que margen
3. Plazos y cupo: coherencia entre lo solicitado y lo recomendado, con sugerencias concretas
4. Conclusion: recomendacion final en una oracion`;

export function buildCreditStudyUserMessage(study: {
  customerName: string;
  customerCity: string;
  seniority: number;
  requestedTerm: number;
  requestedMonthlyCreditLine: number;
  viabilityScore: number;
  viabilityStatus: string;
  recommendedTerm: number;
  recommendedCreditLine: number;
  monthlyPaymentCapacity: number;
  annualPaymentCapacity: number;
  ebitda: number;
  currentDebtService: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  ordinaryActivityRevenue: number;
  grossProfit: number;
  netIncome: number;
  viabilityConditions: {
    dimensions: Record<
      string,
      { score: number; maxScore: number; status: string; label: string }
    >;
    alerts: Array<{ type: string; dimension: string; message: string }>;
    summary: { totalScore: number; maxScore: number; status: string };
  };
}): string {
  const dims = study.viabilityConditions.dimensions;
  const alerts = study.viabilityConditions.alerts;

  return `DATOS DEL ESTUDIO DE CREDITO:

Cliente: ${study.customerName}
Ciudad: ${study.customerCity}
Antiguedad: ${study.seniority} anos

Cupo mensual solicitado: $${study.requestedMonthlyCreditLine.toLocaleString('es-CO')}
Plazo solicitado: ${study.requestedTerm} dias
Cupo recomendado: $${study.recommendedCreditLine.toLocaleString('es-CO')}
Plazo recomendado: ${study.recommendedTerm} dias

Score de viabilidad: ${study.viabilityScore} / 100
Veredicto: ${study.viabilityStatus === 'approved' ? 'APROBADO' : study.viabilityStatus === 'conditional' ? 'APROBADO CON CONDICIONES' : 'NO APROBADO'}

INDICADORES FINANCIEROS:
Ingresos ordinarios: $${study.ordinaryActivityRevenue.toLocaleString('es-CO')}
Utilidad bruta: $${study.grossProfit.toLocaleString('es-CO')}
EBITDA: $${study.ebitda.toLocaleString('es-CO')}
Servicio de deuda actual: $${study.currentDebtService.toLocaleString('es-CO')}
Capacidad de pago mensual: $${study.monthlyPaymentCapacity.toLocaleString('es-CO')}
Capacidad de pago anual: $${study.annualPaymentCapacity.toLocaleString('es-CO')}
Total activos: $${study.totalAssets.toLocaleString('es-CO')}
Total pasivos: $${study.totalLiabilities.toLocaleString('es-CO')}
Patrimonio: $${study.equity.toLocaleString('es-CO')}

EVALUACION POR DIMENSION:
${Object.values(dims)
  .map((d) => `- ${d.label}: ${d.score}/${d.maxScore} (${d.status})`)
  .join('\n')}

ALERTAS DEL SISTEMA:
${alerts.map((a) => `- [${a.type.toUpperCase()}] ${a.message}`).join('\n')}`;
}
