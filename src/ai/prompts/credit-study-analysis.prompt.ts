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

export const FINANCIAL_PDF_EXTRACTION_PROMPT = `Eres un experto en contabilidad colombiana. Analiza este PDF de estados financieros y extrae los datos en el siguiente formato JSON.

REGLAS:
- Todos los valores monetarios deben ser numeros sin formato (sin puntos, sin comas, sin signo $)
- Si un campo no se encuentra en el documento, usa null
- Los campos con sufijo "1" corresponden al ano mas reciente y "2" al ano anterior
- Busca las cifras en el balance general, estado de resultados y notas
- Si hay valores negativos, representalos con signo negativo
- Responde UNICAMENTE con el JSON, sin texto adicional ni markdown

{
  "balanceSheetDate": "YYYY-MM-DD",

  "cashAndEquivalents": null,
  "accountsReceivable1": null,
  "accountsReceivable2": null,
  "inventories1": null,
  "inventories2": null,
  "totalCurrentAssets": null,

  "fixedAssetsProperty": null,
  "totalNonCurrentAssets": null,

  "shortTermFinancialLiabilities": null,
  "suppliers1": null,
  "suppliers2": null,
  "totalCurrentLiabilities": null,

  "longTermFinancialLiabilities": null,
  "totalNonCurrentLiabilities": null,

  "retainedEarnings": null,
  "netIncome": null,

  "ordinaryActivityRevenue": null,
  "costOfSales": null,
  "administrativeExpenses": null,
  "sellingExpenses": null,
  "depreciation": null,
  "amortization": null,
  "financialExpenses": null,
  "taxes": null
}

Mapeo de campos con terminologia contable colombiana:
- cashAndEquivalents = Efectivo y equivalentes de efectivo
- accountsReceivable = Deudores comerciales / Cuentas por cobrar
- inventories = Inventarios
- totalCurrentAssets = Total activos corrientes
- fixedAssetsProperty = Propiedades, planta y equipo
- totalNonCurrentAssets = Total activos no corrientes
- shortTermFinancialLiabilities = Obligaciones financieras a corto plazo
- suppliers = Proveedores / Cuentas por pagar comerciales
- totalCurrentLiabilities = Total pasivos corrientes
- longTermFinancialLiabilities = Obligaciones financieras a largo plazo
- totalNonCurrentLiabilities = Total pasivos no corrientes
- retainedEarnings = Resultados acumulados / Ganancias retenidas
- netIncome = Resultado del ejercicio / Utilidad neta
- ordinaryActivityRevenue = Ingresos de actividades ordinarias
- costOfSales = Costo de ventas
- administrativeExpenses = Gastos de administracion
- sellingExpenses = Gastos de ventas / distribucion
- depreciation = Depreciacion
- amortization = Amortizacion
- financialExpenses = Gastos financieros
- taxes = Impuesto a las ganancias / Impuesto de renta`;
