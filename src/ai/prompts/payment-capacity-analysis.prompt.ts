// ─── Prompt del INFORME EJECUTIVO IA del estudio de capacidad de pago ──────
// Análogo del prompt de credit-study-analysis (EEFF) para el estudio de
// capacidad (PN sin EEFF): la evidencia son extractos bancarios + comprobantes
// de ingreso verificados en código, no estados financieros. Misma disciplina:
// la IA REDACTA sobre cifras ya calculadas; jamás recalcula ni inventa.

export const PAYMENT_CAPACITY_SYSTEM_PROMPT = `Eres un analista de credito senior especializado en credito a personas naturales en Colombia. Generas informes ejecutivos claros para el prestamista que toma la decision.

REGLAS DE FORMATO:
- Responde UNICAMENTE en espanol
- NO uses markdown, encabezados ni listas con vinetas. Escribe en parrafos fluidos
- Maximo 5 parrafos cortos y directos
- Todos los valores monetarios van en pesos colombianos con separador de miles (punto) y sin decimales. Ejemplo: $3.500.000 (tres millones quinientos mil pesos)
- NUNCA confundas la escala de las cifras. Si el dato dice 3500000 son tres millones quinientos mil, NO tres mil quinientos millones

REGLAS DE CONTENIDO:
- NO inventes datos, cifras ni recomendaciones que no esten en el input
- NO menciones metodologias internas ni nombres tecnicos de dimensiones o validaciones (di "las verificaciones automaticas de los documentos", no "V7")
- NUNCA avales un monto mayor al MONTO APROBADO POR EL SISTEMA. Si es menor al solicitado, explica que se recorto y por que
- Basa tu analisis EXCLUSIVAMENTE en los indicadores, alertas, dimensiones, validaciones y datos de la central proporcionados

CONTEXTO DEL ESTUDIO DE CAPACIDAD DE PAGO:
- Este estudio NO usa estados financieros: analiza el FLUJO DE CAJA REAL del cliente sobre sus extractos bancarios (minimo 3 meses) mas su comprobante de ingreso (desprendible de nomina o facturas de contratista), todo verificado con validaciones automaticas en codigo (cuadre de saldos linea a linea, cruce nomina-cuenta, identidad del titular)
- El INGRESO VERIFICADO es lo que realmente entra a la cuenta del cliente, no lo que declara. El INGRESO DISPONIBLE es lo que queda tras gastos fijos recurrentes y cuotas de deudas existentes detectadas en los extractos (incluidas deudas que NO aparecen en la central)
- La CUOTA MAXIMA SUGERIDA es el menor entre el 30% del ingreso verificado y el 70% del ingreso disponible: es el numero que el prestamista necesita
- El DTI (cuotas sobre ingreso) se lee asi: sano por debajo de 30%, justo entre 30% y 45%, critico por encima de 45%. Manda el DTI PROYECTADO (con la cuota del credito pedido)
- El score de viabilidad va de 0 a 100 y pondera las dimensiones que la empresa habilito, cada una con su peso. Una dimension "no evaluable" redistribuyo su peso y NO es una carencia del cliente. Las dimensiones no habilitadas no existen para este analisis: NO las menciones
- RIESGO DE LA CENTRAL: opinion de DataCredito Experian sobre el historial crediticio (puntaje 150-950, viabilidad de pago, mora). Complementa lo que los extractos muestran: los extractos ven deudas y comportamiento que la central no ve, y la central ve historial que los extractos no muestran

VERACIDAD DOCUMENTAL:
- Los documentos pasaron validaciones automaticas deterministas: cuadre del saldo linea a linea, cuadre del resumen del banco, continuidad entre extractos consecutivos, identidad del titular contra la persona consultada, y el cruce mas fuerte: que la nomina se consigne EXACTAMENTE en la cuenta del extracto aportado
- Una validacion FALLIDA sugiere documento alterado o incompleto: mencionala como senal seria que amerita verificacion antes de desembolsar

RECHAZO ELIMINATORIO:
- Si el input trae un "RECHAZO ELIMINATORIO" (sin ingreso verificable, o ingreso totalmente comprometido), el veredicto es NO APROBADO por esa causa SOLA. El primer parrafo abre con ese motivo; NO presentes el score como si estuviera cerca de aprobarse

ESTRUCTURA (hasta 5 parrafos, sin titulos):
1. Diagnostico: veredicto (aprobado/condicional/rechazado), score, y que dimensiones puntuan bien o mal en lenguaje natural. Si hubo rechazo eliminatorio, ese motivo manda
2. Ingreso y capacidad: ingreso verificado (y como se verifico: nomina contra cuenta, o abonos del extracto contra facturas), estabilidad (meses con ingreso, variacion), ingreso disponible y cuota maxima sugerida vs la cuota implicita del credito pedido
3. Endeudamiento y comportamiento: DTI actual y proyectado, obligaciones detectadas en los extractos (incluida deuda invisible a la central), senales de comportamiento (dias en negativo, retiros inmediatos, apuestas, colchon)
4. Central y veracidad documental: opinion de la central, y el resultado de las verificaciones automaticas de los documentos (todas superadas, o cuales fallaron y que sugieren)
5. Conclusion: recomendacion concreta basada SOLO en los datos (aprobar por el monto aprobado, aprobar con condiciones, o rechazar), y las verificaciones adicionales que ameriten las senales encontradas`;

/** Entrada del mensaje de usuario del informe IA de capacidad de pago. */
export interface PaymentCapacityPromptInput {
  customerName: string;
  customerCity: string;
  employmentTypeLabel: string; // 'Asalariado' | 'Independiente'
  requestedCreditLine: number;
  viabilityScore: number;
  viabilityStatus: string;
  approvedCreditLine: {
    amount: number | null;
    requested: number | null;
    suggestedByBureau: number | null;
    cappedByCapacity: boolean;
  };
  capacityFigures: {
    verifiedMonthlyIncome: number;
    payrollNetIncome: number | null;
    bankStatementIncome: number;
    incomeVerificationIndex: number | null;
    incomeCv: number | null;
    monthsWithIncome: number;
    coveredMonths: number;
    windowMonths: number;
    recurringFixedExpenses: number;
    existingDebtPayments: number;
    debtServicePayments: number;
    cardPayments: number;
    livingCost: number;
    availableIncome: number;
    maxSuggestedInstallment: number;
    payrollLoanCapacity: number | null;
    currentDti: number | null;
    minInstallmentsForRequested: number | null;
    paysOwnSocialSecurity: boolean;
    verifiedHireDate: string | null;
  };
  /** Obligaciones detectadas en los extractos (para el detalle del párrafo 3). */
  detectedObligations: Array<{
    kind: string;
    counterparty: string;
    /** Total del periodo y desglose: los estudios previos al cambio no los traen. */
    totalAmount?: number;
    monthlyTotals?: Array<{ month: string; amount: number }>;
    monthlyAverage: number;
    confidence: string;
  }>;
  behavior: {
    averageBalance: number | null;
    daysNegative: number;
    daysAtZero: number;
    pctWithdrawn48h: number | null;
    gamblingPctOfIncome: number | null;
    walletTransfersCount: number;
  } | null;
  centralRisk: {
    score: number | null;
    scoreBandLabel: string | null;
    viabilidad: string | null;
    hasArrears: boolean;
    montoSugerido: number | null;
  } | null;
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
  eliminatoryReason?: string | null;
  /** Flags de fiabilidad (extracción + validaciones fallidas). */
  reliabilityFlags: Array<{
    severity: string;
    category: string;
    title: string;
    detail: string;
  }>;
  centralRiskFlags?: Array<{
    severity: string;
    category: string;
    title: string;
    detail: string;
  }>;
}

export function buildPaymentCapacityUserMessage(
  study: PaymentCapacityPromptInput,
): string {
  const fmt = (n: number | null) =>
    n === null ? 'N/D' : Math.round(n).toLocaleString('es-CO');
  const pctFmt = (r: number | null) =>
    r === null ? 'N/D' : `${Math.round(r * 100)}%`;

  const cf = study.capacityFigures;

  const verdict =
    study.viabilityStatus === 'approved'
      ? 'APROBADO'
      : study.viabilityStatus === 'conditional'
        ? 'APROBADO CON CONDICIONES'
        : 'NO APROBADO';

  const dimsText = Object.values(study.dimensions)
    .map((d) => {
      if (!d.evaluable) {
        return `- ${d.label}: NO EVALUABLE (sin datos; su peso se redistribuyo, no cuenta como carencia del cliente)`;
      }
      const ratioPct = d.ratio !== null ? `${Math.round(d.ratio * 100)}%` : '—';
      return `- ${d.label}: cumplimiento ${ratioPct}, peso ${d.weight}, aporta ${d.contribution} pts (${d.status})`;
    })
    .join('\n');

  const verificationText =
    cf.incomeVerificationIndex !== null
      ? `Indice de verificacion nomina-cuenta: ${pctFmt(cf.incomeVerificationIndex)} (el ${pctFmt(cf.incomeVerificationIndex)} del neto declarado llega efectivamente a la cuenta; por debajo de 90% es senal de alerta)`
      : 'Indice de verificacion: no aplica (el ingreso verificado ES el que muestra el extracto)';

  // Se le pasa el TOTAL del periodo y el desglose mes a mes, no solo el
  // promedio: sin eso la narrativa citaba cifras que no estan en el extracto.
  const obligationsText =
    study.detectedObligations.length > 0
      ? study.detectedObligations
          .map((o) => {
            const kindText =
              o.kind === 'loan'
                ? 'cuota de credito detectada'
                : o.kind === 'card'
                  ? 'servicio de tarjeta de credito'
                  : 'obligacion probable por recurrencia';
            const breakdown = (o.monthlyTotals ?? [])
              .map((m) => `${m.month}: $${fmt(m.amount)}`)
              .join(', ');
            const total = o.totalAmount ?? o.monthlyAverage;
            return (
              `- ${o.counterparty}: total pagado $${fmt(total)} en el periodo` +
              `${breakdown ? ` (${breakdown})` : ''}, promedio $${fmt(o.monthlyAverage)}/mes ` +
              `(${kindText}, confianza ${o.confidence === 'high' ? 'alta' : 'media'})`
            );
          })
          .join('\n')
      : 'Ninguna obligacion detectada en los extractos';

  const b = study.behavior;
  const behaviorText = b
    ? `Saldo promedio: $${fmt(b.averageBalance)} | Dias con saldo negativo: ${b.daysNegative} | Dias en cero: ${b.daysAtZero}
Retiro en las 48h siguientes al abono: ${pctFmt(b.pctWithdrawn48h)} del ingreso
Apuestas en linea: ${pctFmt(b.gamblingPctOfIncome)} del ingreso
Transferencias a billeteras digitales: ${b.walletTransfersCount} (bolsillo no visible sin el extracto de la billetera)`
    : 'Sin datos de comportamiento.';

  const cr = study.centralRisk;
  const centralText = cr
    ? `Puntaje central: ${cr.score ?? 'N/D'}${cr.scoreBandLabel ? ` (${cr.scoreBandLabel})` : ''}
Viabilidad de pago segun la central: ${cr.viabilidad ?? 'N/D'}
Comportamiento de pago: ${cr.hasArrears ? 'CON mora reciente en el historial' : 'sin mora reciente'}
Monto sugerido por la central (referencia, NO techo): $${fmt(cr.montoSugerido)}`
    : 'No hay consulta a la central para este cliente.';

  const acl = study.approvedCreditLine;
  const approvedText = acl.cappedByCapacity
    ? `Monto aprobado por el sistema: $${fmt(acl.amount)} (RECORTADO por capacidad: el cliente solicito $${fmt(acl.requested)}, pero su cuota maxima sugerida solo soporta hasta $${fmt(acl.amount)} en el plazo pedido)`
    : `Monto aprobado por el sistema: $${fmt(acl.amount)} (dentro de la capacidad de pago verificada)`;

  const alertsText =
    study.alerts.length > 0
      ? study.alerts
          .map((a) => `- [${a.type.toUpperCase()}] ${a.message}`)
          .join('\n')
      : 'Ninguna';

  const flagsText =
    study.reliabilityFlags.length > 0
      ? study.reliabilityFlags
          .map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`)
          .join('\n')
      : 'Ninguna (documentos consistentes: todas las verificaciones automaticas superadas)';

  const centralFlags = study.centralRiskFlags ?? [];
  const centralFlagsText =
    centralFlags.length > 0
      ? centralFlags
          .map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`)
          .join('\n')
      : 'Ninguna';

  const eliminatoryText = study.eliminatoryReason
    ? `\nRECHAZO ELIMINATORIO: ${study.eliminatoryReason} Este motivo por si solo determina el veredicto (NO APROBADO), sin importar el score.\n`
    : '';

  const hireText = cf.verifiedHireDate
    ? `Antiguedad laboral verificada desde: ${cf.verifiedHireDate}`
    : 'Antiguedad laboral: sin dato verificable';

  const libranzaText =
    cf.payrollLoanCapacity !== null
      ? `Cupo de libranza disponible (Ley 1527): $${fmt(cf.payrollLoanCapacity)}`
      : '';

  return `DATOS DEL ESTUDIO DE CAPACIDAD DE PAGO:

Cliente: ${study.customerName} (persona natural, ${study.employmentTypeLabel})
Ciudad: ${study.customerCity}

SOLICITUD (contexto, NO base del analisis):
Monto solicitado: $${fmt(study.requestedCreditLine)}
${cf.minInstallmentsForRequested !== null ? `Ese monto cabria en minimo ${cf.minInstallmentsForRequested} cuota(s) de la cuota maxima sostenible, SIN intereses.` : 'No hay cuota maxima sostenible: el monto no es pagable en ningun plazo.'}
NOTA: este estudio NO pide plazo. No recomiendes plazos, tasas ni numero de
cuotas: mide la capacidad mensual del titular y quien otorga el credito decide
monto, plazo y tasa.

VEREDICTO DEL SISTEMA:
Score de viabilidad: ${study.viabilityScore} / 100
Veredicto: ${verdict}
${eliminatoryText}${approvedText}

INGRESO VERIFICADO (sobre ${cf.coveredMonths} mes(es) de extractos; ventana requerida: ${cf.windowMonths}):
Ingreso mensual verificado: $${fmt(cf.verifiedMonthlyIncome)}
${cf.payrollNetIncome !== null ? `Neto promedio de nomina (desprendible): $${fmt(cf.payrollNetIncome)}` : `Ingreso promedio segun extractos: $${fmt(cf.bankStatementIncome)}`}
${verificationText}
Meses con ingreso: ${cf.monthsWithIncome} de ${cf.coveredMonths} | Variacion del ingreso mes a mes: ${pctFmt(cf.incomeCv)}
${hireText}
${cf.paysOwnSocialSecurity ? 'Paga su propia seguridad social (PILA): senal de formalidad' : ''}

CAPACIDAD DE PAGO:
Compromisos fijos (arriendo, salud, educacion, servicios, telecom, seguros): $${fmt(cf.recurringFixedExpenses)}/mes
Cuotas de credito (esto es lo que cuenta como DEUDA): $${fmt(cf.debtServicePayments)}/mes
Pago de tarjetas de credito: $${fmt(cf.cardPayments)}/mes — sale de la cuenta y resta del disponible, pero NO se cuenta como deuda: el extracto no distingue el pago minimo del pago total
Total que sale por obligaciones: $${fmt(cf.existingDebtPayments)}/mes
Ingreso disponible: $${fmt(cf.availableIncome)}/mes
Costo de vida observado (mercado, transporte, compras, retiros): $${fmt(cf.livingCost)}/mes — NO se resta del disponible; a la subsistencia responde el tope del 30% del ingreso en la cuota maxima
CUOTA MAXIMA SUGERIDA: $${fmt(cf.maxSuggestedInstallment)}/mes (menor entre 30% del ingreso y 70% del disponible)
${libranzaText}

ENDEUDAMIENTO:
DTI actual (cuotas de credito que YA paga / ingreso verificado, SIN tarjetas): ${pctFmt(cf.currentDti)}
(sano < 30%, justo 30-45%, critico > 45%)

OBLIGACIONES DETECTADAS EN LOS EXTRACTOS (incluye deuda que la central no ve):
${obligationsText}

COMPORTAMIENTO FINANCIERO (segun extractos):
${behaviorText}

DIMENSIONES PONDERADAS (cumplimiento 0-100% x peso configurado por la empresa):
${dimsText}

ALERTAS DEL SISTEMA:
${alertsText}

OPINION DE LA CENTRAL DE RIESGO (DataCredito Experian):
${centralText}

RED FLAGS DE LA CENTRAL:
${centralFlagsText}

SENALES DE FIABILIDAD DOCUMENTAL (extraccion + verificaciones automaticas):
${flagsText}`;
}
