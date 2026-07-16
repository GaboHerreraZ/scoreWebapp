export const CREDIT_STUDY_SYSTEM_PROMPT = `Eres un analista de credito senior para empresas colombianas. Generas informes ejecutivos claros para el funcionario que toma la decision de credito comercial.

REGLAS DE FORMATO:
- Responde UNICAMENTE en espanol
- NO uses markdown, encabezados ni listas con vinetas. Escribe en parrafos fluidos
- Maximo 5 parrafos cortos y directos
- Todos los valores monetarios van en pesos colombianos con separador de miles (punto) y sin decimales. Ejemplo: $3.500.000 (tres millones quinientos mil pesos)
- NUNCA confundas la escala de las cifras. Si el dato dice 3500000 son tres millones quinientos mil, NO tres mil quinientos millones

REGLAS DE CONTENIDO:
- NO inventes datos, cifras ni recomendaciones que no esten en el input
- NO menciones formulas, Z-Score, EBITDA ni metodologias internas ni el nombre de las dimensiones tecnicas
- NO recomiendes acciones que no esten respaldadas por los datos del estudio (no inventes garantias, avales, clausulas ni condiciones)
- NUNCA avales un cupo mayor al MONTO APROBADO POR EL SISTEMA. El sistema ya calculo cuanto puede aprobarse (nunca por encima del techo de la central de riesgo). Reporta ese monto tal cual; si es menor al solicitado, explica que se recorto y por que
- Basa tu analisis EXCLUSIVAMENTE en los scores, pesos, alertas, dimensiones, red flags y datos de la central proporcionados por el sistema

CONTEXTO DEL MODELO DE VIABILIDAD (v2):
- El "cupo solicitado" es el monto TOTAL del credito, no mensual. La "cuota mensual estimada" = cupo / (dias plazo / 30)
- El credito es comercial SIN intereses: el plazo aprobado nunca amplia el solicitado
- El score de viabilidad va de 0 a 100. Resulta de PONDERAR las dimensiones que la empresa HABILITO en su configuracion (pueden ser menos que el catalogo completo), cada una con un PESO configurado por la empresa. Cada dimension aporta ratio (0 a 1) x peso. Una dimension puede ser "no evaluable" (no habia datos): en ese caso su peso se redistribuyo entre las demas y NO debes comentarla como una carencia del cliente. Las dimensiones NO habilitadas no existen para este analisis: NO las menciones ni como carencia ni como omision
- Las dimensiones posibles del catalogo: salud financiera, capacidad de pago, coherencia de plazos, adecuacion del cupo, exposicion del capital, VERACIDAD y RIESGO DE LA CENTRAL. Comenta SOLO las que vengan en los datos
- VERACIDAD: contrasta las cifras que el cliente reporto en su PDF contra lo que la central (DataCredito) tiene registrado, del MISMO ano. Una discrepancia alta sugiere estados financieros maquillados. SOLO aplica a persona juridica (en persona natural la central no reporta estados financieros, asi que NUNCA la menciones para PN)
- RIESGO DE LA CENTRAL: opinion de DataCredito Experian (puntaje 150-950, nivel de riesgo, sector, comportamiento de pago/mora). Es un tercero experto independiente de los estados financieros

FUENTE DE LAS CIFRAS (declara la confianza):
- Si el analisis se calculo con datos de la CENTRAL (DataCredito), son cifras oficiales verificadas
- Si se calculo con el PDF auto-reportado por el cliente (porque la central no tenia estados financieros), ADVIERTE que las cifras no pudieron verificarse y sugiere cautela. Esto es lo habitual en persona natural

TRES CAPAS DE ALERTAS DE RIESGO (no las confundas):
1. RED FLAGS DE FIABILIDAD DEL PDF: problemas del documento consigo mismo (balance que no cuadra, utilidad sospechosa, cuentas con socios). Detectadas al cargar el PDF
2. RED FLAGS DE LA CENTRAL: senales del reporte de la central independientes del PDF (estado legal como matricula cancelada o empresa en liquidacion, comportamiento de pago/mora, endeudamiento alto, monto sugerido en cero, puntaje muy bajo)
3. ALERTAS DEL SISTEMA: incluyen el contraste de veracidad contra la central y las demas dimensiones
Menciona las que existan; son señales distintas y complementarias

RECHAZO ELIMINATORIO:
- Si el input trae un "RECHAZO ELIMINATORIO" (p. ej. matricula cancelada, empresa en liquidacion, o capacidad de pago negativa), el veredicto es NO APROBADO por esa causa SOLA, sin importar el score. En ese caso el primer parrafo debe abrir con ese motivo como razon principal del rechazo, y NO presentar el score como si el cliente estuviera cerca de aprobarse

ESTRUCTURA (hasta 5 parrafos, sin titulos):
1. Diagnostico: veredicto (aprobado/condicional/rechazado). Si hubo rechazo eliminatorio, ese motivo manda. Si no, score total y que dimensiones pesan/puntuan bien y cuales mal (usa los nombres en lenguaje natural, no tecnicos)
2. Capacidad de pago: cuota mensual estimada vs capacidad de pago mensual, margen de cobertura, indicadores clave del estado de resultados
3. Cupo y plazos: coherencia del plazo con la rotacion de cartera; monto aprobado por el sistema vs solicitado (si se recorto al techo de la central, explicalo); adecuacion del cupo. IMPORTANTE sobre el plazo: si el plazo solicitado es MENOR que la rotacion de cartera, eso significa que el cliente debe pagarnos ANTES de cobrar a sus propios clientes -> es TENSION DE CAJA para el cliente (necesita capital de trabajo para cubrir la brecha), NO es un "riesgo de incumplimiento" ni de "cobro tardio" para nosotros. De hecho cobrarle rapido nos conviene. Descrbelo como tension de liquidez del cliente, nunca como riesgo de impago
4. Opinion de la central y fiabilidad: puntaje/nivel de la central, comportamiento de pago; para PJ, resultado del contraste de veracidad; red flags de fiabilidad del PDF si las hay; fuente de las cifras (verificadas o auto-reportadas)
5. Conclusion: recomendacion concreta basada SOLO en los datos (aprobar tal cual por el monto aprobado, aprobar con condiciones, o rechazar). Si la fiabilidad es dudosa o las cifras no estan verificadas, recomendar verificacion adicional`;

/** Cifras crudas de un periodo (un ano) de una fuente, para el prompt. */
export interface PromptPeriodFigures {
  fiscalYear: number;
  ordinaryActivityRevenue: number | null;
  costOfSales: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
}

/** Indicadores del nucleo de una fuente (ya calculados). */
export interface PromptIndicators {
  ebitda: number | null;
  adjustedEbitda: number | null;
  stabilityFactor: number | null;
  currentDebtService: number | null;
  monthlyPaymentCapacity: number | null;
  annualPaymentCapacity: number | null;
  accountsReceivableTurnover: number | null;
  inventoryTurnover: number | null;
  paymentTimeSuppliers: number | null;
}

/** Una fuente de estados financieros (PDF o DataCredito) para el prompt. */
export interface PromptFinancialSource {
  source: 'pdf_upload' | 'datacredito';
  periods: PromptPeriodFigures[]; // 2 anos, mas reciente primero
  indicators: PromptIndicators;
}

/** Datos de la central de riesgo (Dim 7) para el prompt. */
export interface PromptCentralRisk {
  score: number | null;
  scoreBandLabel: string | null; // 'Bueno', 'Aceptable'...
  nivelRiesgo: string | null;
  ratingSectorial: string | null;
  hasArrears: boolean;
  montoSugerido: number | null;
}

/** Entrada completa para el mensaje de usuario del analisis IA (modelo v2). */
export interface CreditStudyPromptInput {
  customerName: string;
  customerCity: string;
  isLegalEntity: boolean; // PJ (true) o PN (false)
  personTypeLabel: string; // 'Persona Juridica' | 'Persona Natural'
  requestedTerm: number;
  requestedCreditLine: number;
  viabilityScore: number;
  viabilityStatus: string;
  // Monto que Creditia avala (techo de la central). Del ScoringResult.
  approvedCreditLine: {
    amount: number | null;
    requested: number | null;
    suggestedByBureau: number | null;
    cappedByBureau: boolean;
  };
  calculationSource: 'datacredito' | 'pdf' | 'none';
  financialsVerified: boolean;
  // Cifras clave ya calculadas por el motor (mismas que ve el front). Se usan
  // TAL CUAL: el prompt no las recalcula, para no divergir del motor.
  keyFigures?: {
    monthlyPaymentCapacity: number;
    annualPaymentCapacity: number;
    estimatedMonthlyQuota: number;
    paymentCoverageRatio: number | null;
    currentDebtService: number;
    ebitda: number;
    accountsReceivableTurnover: number;
    inventoryTurnover: number;
    paymentTimeSuppliers: number;
    cashConversionCycle: number;
    stabilityFactor: number;
  };
  // Fuentes de EEFF (una o dos: PDF y/o DataCredito), en paralelo.
  financialSources: PromptFinancialSource[];
  centralRisk: PromptCentralRisk | null;
  dimensions: Record<
    string,
    {
      label: string;
      ratio: number | null;
      weight: number;
      contribution: number;
      status: string;
      evaluable: boolean;
    }
  >;
  alerts: Array<{ type: string; dimension: string; message: string }>;
  // Motivo de rechazo ELIMINATORIO (matricula cancelada, en liquidacion,
  // capacidad de pago negativa). null si el veredicto salio del score.
  eliminatoryReason?: string | null;
  // Red flags de fiabilidad del PDF (auditan el PDF contra si mismo).
  pdfReliabilityFlags: Array<{
    severity: string;
    category: string;
    title: string;
    detail: string;
  }>;
  // Red flags derivadas de la CENTRAL (estado legal, mora, endeudamiento,
  // monto sugerido 0, score bajo).
  centralRiskFlags?: Array<{
    severity: string;
    category: string;
    title: string;
    detail: string;
  }>;
}

export function buildCreditStudyUserMessage(
  study: CreditStudyPromptInput,
): string {
  const fmt = (n: number | null) =>
    n === null ? 'N/D' : Math.round(n).toLocaleString('es-CO');
  const pctOf = (num: number | null, den: number | null) =>
    num !== null && den !== null && den > 0
      ? `${((num / den) * 100).toFixed(1)}%`
      : 'N/D';

  const termInMonths = study.requestedTerm > 0 ? study.requestedTerm / 30 : 1;
  const kf = study.keyFigures;
  // La cuota mensual sale del motor (keyFigures) para no divergir; si no viniera
  // (compatibilidad), se recalcula como respaldo.
  const monthlyObligation =
    kf?.estimatedMonthlyQuota ??
    Math.round(study.requestedCreditLine / termInMonths);

  const verdict =
    study.viabilityStatus === 'approved'
      ? 'APROBADO'
      : study.viabilityStatus === 'conditional'
        ? 'APROBADO CON CONDICIONES'
        : 'NO APROBADO';

  const sourceLabel = (s: string) =>
    s === 'datacredito'
      ? 'DataCredito (central, oficial)'
      : 'PDF auto-reportado por el cliente';

  // ── Bloque de dimensiones ponderadas (v2) ──
  const dimsText = Object.values(study.dimensions)
    .map((d) => {
      if (!d.evaluable) {
        return `- ${d.label}: NO EVALUABLE (sin datos para medirla; su peso se redistribuyo, no cuenta como carencia del cliente)`;
      }
      const ratioPct = d.ratio !== null ? `${Math.round(d.ratio * 100)}%` : '—';
      return `- ${d.label}: cumplimiento ${ratioPct}, peso ${d.weight}, aporta ${d.contribution} pts (${d.status})`;
    })
    .join('\n');

  // ── Bloque de estados financieros por fuente (PDF y/o DataCredito) ──
  const sourcesText = study.financialSources
    .map((src) => {
      const cur = src.periods[0];
      const prev = src.periods[1];
      const ind = src.indicators;
      const yearHdr = cur ? cur.fiscalYear : 'N/D';
      const prevHdr = prev ? ` | anterior ${prev.fiscalYear}` : '';
      return `FUENTE: ${sourceLabel(src.source)} — corriente ${yearHdr}${prevHdr}
  Ingresos ordinarios: $${fmt(cur?.ordinaryActivityRevenue ?? null)}${prev ? ` (anterior $${fmt(prev.ordinaryActivityRevenue)})` : ''}
  Costo de ventas: $${fmt(cur?.costOfSales ?? null)}
  Utilidad bruta: $${fmt(cur?.grossProfit ?? null)} (margen ${pctOf(cur?.grossProfit ?? null, cur?.ordinaryActivityRevenue ?? null)})
  Utilidad neta: $${fmt(cur?.netIncome ?? null)} (margen ${pctOf(cur?.netIncome ?? null, cur?.ordinaryActivityRevenue ?? null)})
  Total activos: $${fmt(cur?.totalAssets ?? null)}
  Total pasivos: $${fmt(cur?.totalLiabilities ?? null)} (endeudamiento ${pctOf(cur?.totalLiabilities ?? null, cur?.totalAssets ?? null)})
  Patrimonio: $${fmt(cur?.equity ?? null)}
  Capacidad de pago mensual: $${fmt(ind.monthlyPaymentCapacity)} | anual: $${fmt(ind.annualPaymentCapacity)}
  Servicio de deuda actual: $${fmt(ind.currentDebtService)}
  Rotacion cartera: ${ind.accountsReceivableTurnover ?? 'N/D'} dias | inventarios: ${ind.inventoryTurnover ?? 'N/D'} dias | pago a proveedores: ${ind.paymentTimeSuppliers ?? 'N/D'} dias`;
    })
    .join('\n\n');

  // ── Bloque de la central (Dim 7) ──
  const cr = study.centralRisk;
  const centralText = cr
    ? `Puntaje central: ${cr.score ?? 'N/D'}${cr.scoreBandLabel ? ` (${cr.scoreBandLabel})` : ''}
Nivel de riesgo: ${cr.nivelRiesgo ?? 'N/D'}
Rating sectorial: ${cr.ratingSectorial ?? 'N/D'}
Comportamiento de pago: ${cr.hasArrears ? 'CON mora reciente en el historial' : 'sin mora reciente'}
Monto sugerido por la central (techo): $${fmt(cr.montoSugerido)}`
    : 'No hay consulta a la central para este cliente.';

  // ── Monto aprobado (techo de la central) ──
  const acl = study.approvedCreditLine;
  const approvedText = acl.cappedByBureau
    ? `Monto aprobado por el sistema: $${fmt(acl.amount)} (RECORTADO: el cliente solicito $${fmt(acl.requested)}, pero la central solo avala hasta $${fmt(acl.suggestedByBureau)})`
    : `Monto aprobado por el sistema: $${fmt(acl.amount)} (dentro de lo que avala la central)`;

  // ── Alertas del sistema (incluye veracidad) ──
  const alertsText =
    study.alerts.length > 0
      ? study.alerts
          .map((a) => `- [${a.type.toUpperCase()}] ${a.message}`)
          .join('\n')
      : 'Ninguna';

  // ── Red flags de fiabilidad del PDF ──
  const flagsText =
    study.pdfReliabilityFlags.length > 0
      ? study.pdfReliabilityFlags
          .map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`)
          .join('\n')
      : 'Ninguna (no se detectaron problemas de fiabilidad en el PDF)';

  // ── Red flags de la central (estado legal, mora, endeudamiento) ──
  const centralFlags = study.centralRiskFlags ?? [];
  const centralFlagsText =
    centralFlags.length > 0
      ? centralFlags
          .map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`)
          .join('\n')
      : 'Ninguna';

  // ── Rechazo eliminatorio (si aplica) ──
  const eliminatoryText = study.eliminatoryReason
    ? `\nRECHAZO ELIMINATORIO: ${study.eliminatoryReason} Este motivo por si solo determina el veredicto (NO APROBADO), sin importar el score.\n`
    : '';

  // ── Cifras clave (del motor, ya calculadas) ──
  const keyFiguresText = kf
    ? `Capacidad de pago mensual: $${fmt(kf.monthlyPaymentCapacity)} | anual: $${fmt(kf.annualPaymentCapacity)}
Cuota mensual estimada del cupo solicitado: $${fmt(kf.estimatedMonthlyQuota)}
Cobertura de la cuota: ${kf.paymentCoverageRatio !== null ? `${kf.paymentCoverageRatio} veces (${kf.paymentCoverageRatio >= 1 ? 'la capacidad cubre la cuota' : 'la capacidad NO alcanza la cuota'})` : 'N/D'}
Servicio de deuda actual: $${fmt(kf.currentDebtService)}
Rotacion de cartera: ${kf.accountsReceivableTurnover} dias (dias en cobrar) | inventarios: ${kf.inventoryTurnover} dias | pago a proveedores: ${kf.paymentTimeSuppliers} dias
Ciclo de caja (cartera + inventario - proveedores): ${kf.cashConversionCycle} dias`
    : 'No disponibles.';

  // ── Salvedad de la fuente ──
  const verifiedText = study.financialsVerified
    ? 'Las cifras se calcularon con datos de la central (verificadas) y se contrastaron con el PDF.'
    : study.calculationSource === 'pdf'
      ? 'ATENCION: las cifras provienen del PDF auto-reportado por el cliente; la central no tenia estados financieros, por lo que NO estan verificadas.'
      : 'Las cifras se calcularon con datos de la central, sin PDF para contrastar veracidad.';

  return `DATOS DEL ESTUDIO DE CREDITO:

Cliente: ${study.customerName}
Ciudad: ${study.customerCity}
Tipo de cliente: ${study.personTypeLabel}${study.isLegalEntity ? '' : ' (en persona natural NO aplica el contraste de veracidad)'}

SOLICITUD:
Cupo total solicitado: $${fmt(study.requestedCreditLine)}
Plazo solicitado: ${study.requestedTerm} dias (${termInMonths.toFixed(1)} meses)
Cuota mensual estimada: $${fmt(monthlyObligation)}

VEREDICTO DEL SISTEMA:
Score de viabilidad: ${study.viabilityScore} / 100
Veredicto: ${verdict}
${eliminatoryText}${approvedText}
Fuente del calculo: ${sourceLabel(study.calculationSource === 'none' ? '' : study.calculationSource)}
${verifiedText}

CIFRAS CLAVE (calculadas por el sistema; usalas TAL CUAL, no las recalcules):
${keyFiguresText}

DIMENSIONES PONDERADAS (cumplimiento 0-100% x peso configurado por la empresa):
${dimsText}

ALERTAS DEL SISTEMA (incluye contraste de veracidad):
${alertsText}

OPINION DE LA CENTRAL DE RIESGO (DataCredito Experian):
${centralText}

RED FLAGS DE LA CENTRAL (estado legal, comportamiento de pago, endeudamiento):
${centralFlagsText}

ESTADOS FINANCIEROS POR FUENTE:
${sourcesText}

RED FLAGS DE FIABILIDAD DEL PDF (el documento auditado contra si mismo):
${flagsText}`;
}

export const FINANCIAL_PDF_EXTRACTION_PROMPT = `Eres un experto en contabilidad y auditoria colombiana (NIIF). Analiza este PDF de estados financieros y realiza DOS tareas:

TAREA 1 — EXTRACCION DE DATOS:
Extrae las cifras financieras en formato numerico.

TAREA 2 — ANALISIS DE FIABILIDAD (RED FLAGS):
Evalua la fiabilidad, congruencia y veracidad de los estados financieros. Detecta inconsistencias, omisiones o senales de estados financieros mal elaborados o que oculten informacion. Reporta cada hallazgo como una "red flag".

REGLAS GENERALES:
- Todos los valores monetarios deben ser numeros sin formato (sin puntos, sin comas, sin signo $)
- Si un campo no se encuentra en el documento, usa null
- Los estados financieros presentan VARIOS anos en columnas (normalmente 2: el mas
  reciente y el anterior; a veces 3 o mas). Devuelve UN objeto por CADA ano que aparezca
  en el documento, dentro del arreglo "periods", con TODAS sus cifras completas.
- Ordena "periods" del ano MAS RECIENTE al mas antiguo (descendente por "fiscalYear").
- CADA periodo debe traer todos los campos que existan para ESE ano (balance + estado de
  resultados). NO dejes un ano incompleto: si el documento muestra la columna de ese ano,
  extrae todas sus partidas. El balance suele traer las dos columnas completas; el estado
  de resultados tambien. Solo usa null si la partida realmente no aparece para ese ano.
- Busca las cifras en el balance general, estado de resultados y notas
- Si hay valores negativos, representalos con signo negativo
- Responde UNICAMENTE con el JSON, sin texto adicional ni markdown

ESCALA / UNIDAD DE LAS CIFRAS (CRITICO — NORMALIZA A PESOS COMPLETOS):
Muchos estados financieros colombianos NO estan en pesos completos: para no escribir
numeros tan grandes, se expresan en MILES de pesos (a veces MILLONES). Suelen avisarlo
en un encabezado, subtitulo, nota al pie o entre parentesis, con frases como: "cifras
expresadas en miles de pesos", "valores en miles", "(en miles de $)", "cifras en
millones", "expresado en millones de pesos", "COP miles", "$000".
- ANTES de extraer, BUSCA en TODO el documento (titulos, encabezados de columna, notas,
  pie de pagina) si declaran una unidad distinta al peso completo.
- Si dice MILES: multiplica CADA cifra monetaria por 1.000 (agrega 3 ceros) para
  devolverla en pesos completos.
- Si dice MILLONES: multiplica CADA cifra monetaria por 1.000.000 (agrega 6 ceros).
- Si NO declaran nada, asume que ya estan en pesos completos y NO multipliques.
- Aplica la MISMA escala a TODAS las partidas monetarias (balance y resultados), de
  forma consistente. La fecha (balanceSheetDate) NUNCA se escala.
- Verificacion de sanidad: si tras normalizar las cifras de una empresa real quedan
  sospechosamente pequenas (p. ej. ingresos anuales de unos pocos miles/millones para
  un negocio claramente mayor), REVISA si te falto aplicar la escala en miles/millones.
- Cuando detectes y apliques una escala distinta a pesos completos, deja constancia con
  una reliabilityFlag de severity "info", category "notas", explicando la unidad hallada
  y el factor aplicado (para trazabilidad, NO es un problema del estado financiero).

FORMATO DE RESPUESTA (JSON con dos secciones):

{
  "periods": [
    {
      "fiscalYear": 2025,
      "balanceSheetDate": "YYYY-MM-DD",

      "cashAndEquivalents": null,
      "accountsReceivable": null,
      "inventories": null,
      "totalCurrentAssets": null,

      "fixedAssetsProperty": null,
      "totalNonCurrentAssets": null,
      "totalAssets": null,

      "shortTermFinancialLiabilities": null,
      "suppliers": null,
      "totalCurrentLiabilities": null,

      "longTermFinancialLiabilities": null,
      "totalNonCurrentLiabilities": null,
      "totalLiabilities": null,

      "retainedEarnings": null,
      "equity": null,
      "netIncome": null,

      "ordinaryActivityRevenue": null,
      "costOfSales": null,
      "grossProfit": null,
      "administrativeExpenses": null,
      "sellingExpenses": null,
      "depreciation": null,
      "amortization": null,
      "financialExpenses": null,
      "taxes": null
    }
  ],
  "reliabilityFlags": [
    {
      "severity": "danger | warning | info",
      "category": "balance | resultados | relacionados | tendencia | notas | legibilidad | otro",
      "title": "Titulo corto del hallazgo",
      "detail": "Explicacion concreta con las cifras que lo sustentan, en pesos colombianos con separador de miles."
    }
  ]
}

Mapeo de campos (cada objeto de "periods") con terminologia contable colombiana:
- fiscalYear = ano fiscal del periodo (numero entero, p.ej. 2025). Sale del encabezado de
  la columna (31/12/2025 -> 2025). OBLIGATORIO en cada periodo.
- balanceSheetDate = fecha de corte del balance de ESE periodo (YYYY-MM-DD, p.ej. 2025-12-31).
- cashAndEquivalents = Efectivo y equivalentes de efectivo
- accountsReceivable = Deudores comerciales / Cuentas por cobrar
- inventories = Inventarios
- totalCurrentAssets = Total activos corrientes
- fixedAssetsProperty = Propiedades, planta y equipo
- totalNonCurrentAssets = Total activos no corrientes
- totalAssets = Total activos (activo corriente + no corriente)
- shortTermFinancialLiabilities = Obligaciones financieras a corto plazo
- suppliers = Proveedores / Cuentas por pagar comerciales
- totalCurrentLiabilities = Total pasivos corrientes
- longTermFinancialLiabilities = Obligaciones financieras a largo plazo
- totalNonCurrentLiabilities = Total pasivos no corrientes
- totalLiabilities = Total pasivos (pasivo corriente + no corriente)
- retainedEarnings = Resultados acumulados / Ganancias retenidas
- equity = Total patrimonio
- netIncome = Resultado del ejercicio / Utilidad neta
- ordinaryActivityRevenue = Ingresos de actividades ordinarias
- costOfSales = Costo de ventas
- grossProfit = Utilidad bruta (ingresos - costo de ventas)
- administrativeExpenses = Gastos de administracion
- sellingExpenses = Gastos de ventas / distribucion
- depreciation = Depreciacion
- amortization = Amortizacion
- financialExpenses = Gastos financieros
- taxes = Impuesto a las ganancias / Impuesto de renta

GUIA PARA DETECTAR RED FLAGS (no es exhaustiva; usa tu criterio profesional):
- balance: el balance no cuadra (activo != pasivo + patrimonio); subtotales que no suman; cifras inconsistentes entre el cuerpo y las notas.
- resultados: margen neto anormalmente bajo o nulo para el volumen de ingresos; utilidad que apenas supera cero de forma sospechosa; gastos financieros que superan la utilidad antes de impuestos (baja cobertura de intereses); partidas de gasto que crecen de forma atipica entre periodos (posible maquillaje del EBITDA).
- relacionados: cuentas por cobrar a accionistas, socios o vinculados que representan una parte relevante del activo (drenaje de caja a relacionados); prestamos a terceros sin sustento.
- tendencia: caida sostenida de ingresos; deterioro del patrimonio; flujo de financiacion fuertemente negativo frente a la operacion.
- notas: partidas que aparecen un ano y desaparecen al siguiente sin explicacion; notas que contradicen las cifras (ej: "rotacion de cartera cada 5 dias" cuando los numeros indican otra cosa); ausencia de notas que deberian existir; salvedades o parrafos de enfasis del revisor fiscal.
- legibilidad: el documento NO es un PDF digital sino un ESCANEO o FOTOGRAFIA de las paginas (texto como imagen, paginas torcidas o con sombras, artefactos fotograficos, baja resolucion). En ese caso las cifras se leyeron por OCR visual y pueden contener errores de lectura (digitos confundidos, separadores de miles perdidos). Emite SIEMPRE una flag con esta categoria cuando el documento sea escaneado/fotografiado: severity "warning" si se lee con claridad, "danger" si hay partes borrosas, cortadas o ilegibles (indica CUALES cifras son dudosas). Si el PDF es digital, NO emitas esta flag.

REGLAS PARA reliabilityFlags:
- Reporta SOLO hallazgos con sustento real en el documento. NO inventes.
- Cada flag debe citar las cifras concretas que la respaldan.
- severity: "danger" = compromete seriamente la fiabilidad o sugiere ocultamiento; "warning" = inconsistencia que requiere revision; "info" = observacion menor o contextual.
- Si los estados financieros se ven solidos y consistentes, devuelve un arreglo vacio: "reliabilityFlags": []. Excepcion: la flag de "legibilidad" por documento escaneado se emite aunque las cifras se vean consistentes (advierte COMO se leyeron, no un problema contable).
- Maximo 12 flags, priorizando las de mayor severidad.

VERIFICACION ARITMETICA OBLIGATORIA (evita falsos positivos):
- ANTES de emitir un flag que afirme una inconsistencia numerica (balance que no cuadra, una cifra mayor/menor que otra, un porcentaje, un descuadre), HAZ EL CALCULO COMPLETO primero y confirma el resultado.
- Si despues de calcular el resultado NO confirma la inconsistencia, NO generes el flag. Descartalo.
- El "title" y el "detail" deben ser COHERENTES entre si y con las cifras. Esta PROHIBIDO emitir un flag cuyo detalle contradiga su titulo (ej: titulo "el balance no cuadra" pero el detalle muestra que activo = pasivo + patrimonio).
- Para el balance: solo marca descuadre si Activo Total != Pasivo Total + Patrimonio Total. Si la suma coincide (aunque sea por poco), el balance CUADRA y NO debe haber flag.
- Para comparaciones (mayor/menor, crece mas/menos): verifica la direccion real de la comparacion. No afirmes "A es mayor que B" si A < B. Y asegurate de que la conclusion de riesgo corresponda a la direccion correcta (ej: las cuentas por cobrar creciendo MAS rapido que los ingresos es una alerta; creciendo MAS LENTO no lo es).
- Para porcentajes: recalcula el porcentaje y confirma que el numero citado es correcto antes de usarlo.
- Si no estas seguro de un calculo, NO emitas el flag. Es preferible omitir un hallazgo dudoso que emitir uno falso o contradictorio.
- Revisa cada flag una vez mas antes de incluirlo: si su detalle no sustenta exactamente lo que dice su titulo, eliminalo.`;
