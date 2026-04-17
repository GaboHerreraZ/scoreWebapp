export const CREDIT_STUDY_SYSTEM_PROMPT = `Eres un analista de credito senior para empresas colombianas. Generas informes ejecutivos claros para el funcionario que toma la decision de credito.

REGLAS DE FORMATO:
- Responde UNICAMENTE en espanol
- NO uses markdown, encabezados ni listas con vinetas. Escribe en parrafos fluidos
- Maximo 4 parrafos cortos y directos
- Todos los valores monetarios van en pesos colombianos con separador de miles (punto) y sin decimales. Ejemplo: $3.500.000 (tres millones quinientos mil pesos)
- NUNCA confundas la escala de las cifras. Si el dato dice 3500000 son tres millones quinientos mil, NO tres mil quinientos millones

REGLAS DE CONTENIDO:
- NO inventes datos, cifras ni recomendaciones que no esten en el input
- NO menciones formulas, Z-Score, EBITDA ni metodologias internas
- NO recomiendes acciones que no esten respaldadas por los datos del estudio (no inventes garantias, avales, clausulas ni condiciones que no aparezcan en el input)
- NUNCA recomiendes un cupo mayor al solicitado. Si la empresa puede pagar mas, indica que el cupo solicitado es viable
- Cuando el cupo no es viable, usa UNICAMENTE las sugerencias de pago proporcionadas en el input como alternativas
- Basa tu analisis exclusivamente en los scores, alertas y dimensiones proporcionadas por el sistema

CONTEXTO:
- El "cupo solicitado" es el monto TOTAL del credito, no un valor mensual
- La "cuota mensual estimada" = cupo / (dias plazo / 30)
- La "rotacion de cartera" indica cuantos dias tarda el cliente en cobrar a sus clientes, y es la referencia para el plazo recomendado
- El score de viabilidad va de 0 a 100, distribuido en 4 dimensiones de 25 puntos cada una
- El factor de estabilidad va de 0.0 a 1.0 (0.33 = empresa joven/inestable, 1.0 = empresa madura y estable)

ESTRUCTURA (4 parrafos, sin titulos):
1. Diagnostico: veredicto (aprobado/condicional/rechazado), score total y desglose por dimensiones. Que dimensiones puntuan bien y cuales mal
2. Capacidad de pago: cuota mensual estimada vs capacidad de pago mensual, margen de cobertura. Indicadores clave del estado de resultados
3. Plazos y cupo: coherencia del plazo con la rotacion de cartera. Si no es viable, presentar las alternativas de las sugerencias de pago del input
4. Conclusion: recomendacion concreta basada SOLO en los datos (aprobar tal cual, aprobar con las condiciones del sistema, o rechazar con las alternativas sugeridas)`;

export function buildCreditStudyUserMessage(study: {
  customerName: string;
  customerCity: string;
  seniority: number;
  requestedTerm: number;
  requestedCreditLine: number;
  viabilityScore: number;
  viabilityStatus: string;
  recommendedTerm: number;
  recommendedCreditLine: number;
  monthlyPaymentCapacity: number;
  annualPaymentCapacity: number;
  ebitda: number;
  adjustedEbitda: number;
  stabilityFactor: number;
  currentDebtService: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  ordinaryActivityRevenue: number;
  costOfSales: number;
  grossProfit: number;
  netIncome: number;
  accountsReceivableTurnover: number;
  inventoryTurnover: number;
  paymentTimeSuppliers: number;
  viabilityConditions: {
    dimensions: Record<
      string,
      { score: number; maxScore: number; status: string; label: string; reason?: string; suggestions?: Array<{ type: string; suggestedTerm: number; suggestedCredit: number; numberOfPayments: number; paymentAmount: number; description: string }> }
    >;
    alerts: Array<{ type: string; dimension: string; message: string }>;
    summary: { totalScore: number; maxScore: number; status: string };
  };
}): string {
  const dims = study.viabilityConditions.dimensions;
  const alerts = study.viabilityConditions.alerts;

  const termInMonths = study.requestedTerm > 0 ? study.requestedTerm / 30 : 1;
  const monthlyObligation = Math.round(study.requestedCreditLine / termInMonths);

  const fmt = (n: number) => n.toLocaleString('es-CO');

  // Build suggestions text
  const suggestions = dims.paymentSuggestions?.suggestions ?? [];
  const suggestionsText = suggestions.length > 0
    ? suggestions.map((s: { type: string; suggestedTerm: number; suggestedCredit: number; numberOfPayments: number; paymentAmount: number; description: string }) => {
        return `- ${s.description}`;
      }).join('\n')
    : 'Ninguna (el cupo solicitado es viable en el plazo solicitado)';

  const debtRatio = study.totalAssets > 0
    ? ((study.totalLiabilities / study.totalAssets) * 100).toFixed(1)
    : 'N/A';

  const grossMargin = study.ordinaryActivityRevenue > 0
    ? ((study.grossProfit / study.ordinaryActivityRevenue) * 100).toFixed(1)
    : 'N/A';

  const netMargin = study.ordinaryActivityRevenue > 0
    ? ((study.netIncome / study.ordinaryActivityRevenue) * 100).toFixed(1)
    : 'N/A';

  return `DATOS DEL ESTUDIO DE CREDITO:

Cliente: ${study.customerName}
Ciudad: ${study.customerCity}
Antiguedad: ${study.seniority} anos
Factor de estabilidad: ${study.stabilityFactor} (escala 0.0 a 1.0)

SOLICITUD:
Cupo total solicitado: $${fmt(study.requestedCreditLine)}
Plazo solicitado: ${study.requestedTerm} dias (${termInMonths.toFixed(1)} meses)
Cuota mensual estimada: $${fmt(monthlyObligation)}

VEREDICTO DEL SISTEMA:
Score de viabilidad: ${study.viabilityScore} / 100
Veredicto: ${study.viabilityStatus === 'approved' ? 'APROBADO' : study.viabilityStatus === 'conditional' ? 'APROBADO CON CONDICIONES' : 'NO APROBADO'}
Cupo recomendado: $${fmt(study.recommendedCreditLine)}
Plazo recomendado: ${study.recommendedTerm} dias

DESGLOSE POR DIMENSION (cada una sobre 25 puntos):
${Object.entries(dims)
  .filter(([key]) => key !== 'paymentSuggestions')
  .map(([, d]) => `- ${d.label}: ${d.score}/${d.maxScore} (${d.status}) — ${d.reason ?? ''}`)
  .join('\n')}

ALERTAS DEL SISTEMA:
${alerts.length > 0 ? alerts.map((a) => `- [${a.type.toUpperCase()}] ${a.message}`).join('\n') : 'Ninguna'}

ESTADO DE RESULTADOS:
Ingresos ordinarios: $${fmt(study.ordinaryActivityRevenue)}
Costo de ventas: $${fmt(study.costOfSales)}
Utilidad bruta: $${fmt(study.grossProfit)} (margen bruto: ${grossMargin}%)
Utilidad neta: $${fmt(study.netIncome)} (margen neto: ${netMargin}%)

BALANCE:
Total activos: $${fmt(study.totalAssets)}
Total pasivos: $${fmt(study.totalLiabilities)} (endeudamiento: ${debtRatio}%)
Patrimonio: $${fmt(study.equity)}

CAPACIDAD DE PAGO:
EBITDA ajustado: $${fmt(Math.round(study.adjustedEbitda))}
Servicio de deuda actual: $${fmt(study.currentDebtService)}
Capacidad de pago mensual: $${fmt(study.monthlyPaymentCapacity)}
Capacidad de pago anual: $${fmt(study.annualPaymentCapacity)}

INDICADORES OPERATIVOS:
Rotacion de cartera: ${study.accountsReceivableTurnover} dias
Rotacion de inventarios: ${study.inventoryTurnover} dias
Tiempo de pago a proveedores: ${study.paymentTimeSuppliers} dias

SUGERENCIAS DE PAGO (alternativas si el cupo no es viable):
${suggestionsText}`;
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
