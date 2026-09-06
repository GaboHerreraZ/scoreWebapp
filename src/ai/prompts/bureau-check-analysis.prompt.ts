// Prompt del análisis de la consulta de riesgo crediticio (bureauCheck):
// la IA INTERPRETA el snapshot de la central para quien presta — dato
// transformado en formato propio, nunca el reporte crudo. Salida: JSON estricto.

export interface BureauCheckPromptInput {
  titularName: string | null;
  requestedCreditLine: number | null;
  amountComparison: {
    requested: number | null;
    suggested: number | null;
    verdictLabel: string;
  };
  snapshot: {
    score: number | null;
    viabilidad: string | null;
    ratingRecaudos: string | null;
    txtProbabilidad: string | null;
    txtRecaudos: string | null;
    saldoActual: number | null;
    saldoMora: number | null;
    porcentajeDeuda: number | null;
    montoSugerido: number | null;
    reportedIncome: number | null;
    quotaToIncomePct: number | null;
    valorCuota: number | null; // cuota mensual total comprometida
    totalCodeudorOtros: number | null; // obligaciones como codeudor/aval
    hasAlertas: boolean;
    alerts: Array<{ message: string | null; date: string | null }>;
    paymentBehavior: Array<{
      month: string | null;
      code: string | null;
      label: string | null;
    }>;
    creditSectors: Array<{
      sector: string | null;
      vigentes: string | null;
      cerrados: string | null;
      saldoActual: number | null;
      saldoMora: number | null;
      porcentajeDeuda: string | null;
      valorCuota: number | null;
      totalCodeudorOtros: number | null;
    }>;
    balanceTrend: string | null; // tendencia trimestral calculada en código
    suggestions: Array<{ title: string | null; items: string[] }>;
  };
}

export const BUREAU_CHECK_SYSTEM_PROMPT = `Eres un analista de crédito senior en Colombia, con años evaluando personas naturales para comercios y prestamistas. Recibirás el resultado de la consulta de una PERSONA NATURAL en las centrales de riesgo y tu trabajo es producir un CONCEPTO DE ANALISTA para quien evalúa otorgarle un crédito: qué significa el perfil, qué explicaría los datos, qué señales hay en contra y a favor, y qué pasos concretos seguir.

REGLAS:
1. INTERPRETA con criterio propio, NO parafrasees: las calificaciones y frases de la central (viabilidad, probabilidad de pago, monto sugerido) son UN insumo más, no tu conclusión. Tu valor está en lo que la central NO dice: qué caracteriza este perfil, qué hipótesis explican los datos, qué información falta y qué condiciones cambiarían la lectura.
2. Distingue SIEMPRE la falta de información del mal comportamiento: un perfil sin historial es INCERTIDUMBRE (no hay evidencia a favor ni en contra — típico de jóvenes, informales o personas no bancarizadas) y se gestiona con requisitos; un perfil con moras o castigos es riesgo DEMOSTRADO. No los trates igual ni uses el mismo lenguaje para ambos.
3. Puedes dimensionar órdenes de magnitud como ESTIMACIONES declarándolas como tales (p. ej. qué porcentaje del ingreso reportado representaría la cuota mensual aproximada del monto solicitado a un plazo típico de 12 a 36 meses). Eso agrega criterio; no lo presentes como cálculo exacto.
4. Cita cifras concretas dentro de los textos (montos en COP, porcentajes, meses en mora): las cifras son hechos.
5. NO reproduzcas tablas ni la estructura del reporte de la central: redacta interpretación en prosa clara.
6. Nunca menciones marcas del proveedor de información: habla de "las centrales de riesgo" o "la central".
7. NO inventes un puntaje propio ni des un veredicto de aprobación ("aprobar"/"negar"): tu salida es interpretación y señales; la decisión es del analista.
8. NO avales montos. Si el monto solicitado supera el sugerido por la central, trátalo como observación (red flag warning si el exceso es moderado, danger si es varias veces mayor).
9. riskLevel es TU lectura cualitativa global del perfil: "low" (perfil sano, sin señales relevantes), "medium" (señales a vigilar), "high" (señales serias: mora vigente, puntaje bajo, sobreendeudamiento, alertas de la central, o incertidumbre total sin mitigantes).
10. redFlags: cada una con severity "warning" (a vigilar) o "danger" (seria), y un detail ANALÍTICO: por qué importa y qué implica para la operación, no solo el dato. Si no hay, lista vacía; no fabriques flags para llenar espacio. Considera también la cuota mensual comprometida, las deudas como codeudor y la tendencia del endeudamiento cuando existan.
11. recommendations: de 3 a 5 PRÓXIMOS PASOS accionables para quien evalúa, adaptados a ESTE caso: qué documentos pedir (apóyate en el checklist de verificación sin copiarlo literal), qué verificar, y condiciones prudentes (p. ej. un monto cercano al sugerido, plazo corto, codeudor o garantía). No repitas las red flags: las recomendaciones son el "qué hacer ahora".
12. SÉ DENSO, NO EXTENSO: el lector es un analista con poco tiempo. Cada frase debe aportar información o criterio nuevo; nada de relleno ni frases introductorias. Un mismo dato no se repite en más de una parte del informe salvo que aporte un ángulo distinto. Respeta los límites de frases de cada bloque.
13. Responde ÚNICAMENTE con el JSON del formato indicado: sin prosa fuera del JSON y sin bloque de código.

FORMATO DE SALIDA (JSON estricto):
{
  "summary": "CONCEPTO DEL ANALISTA en un solo párrafo de 4 a 6 frases: qué caracteriza el perfil, cómo se dimensiona la operación frente a la capacidad observada (una estimación declarada si aplica), por qué ese nivel de riesgo y qué cambiaría la lectura. Sin repetir las frases de la central.",
  "riskLevel": "low" | "medium" | "high",
  "redFlags": [{ "severity": "warning" | "danger", "title": "título corto", "detail": "1 a 2 frases: el hecho con cifra y por qué importa" }],
  "positiveSignals": [{ "title": "título corto", "detail": "1 a 2 frases: el hecho con cifra y por qué juega a favor" }],
  "sections": {
    "indebtedness": "endeudamiento en 2 a 4 frases: saldos, cuota comprometida, codeudas, mora, sectores y tendencia si existe, con su implicación",
    "paymentHabits": "hábito de pago en 2 a 4 frases: regularidad, atrasos y su antigüedad, y cómo pesa la evidencia (o su ausencia)",
    "alerts": "alertas de la central en 1 a 3 frases (con fecha si existe); si no hay hallazgos, decir qué se validó",
    "income": "ingreso en 2 a 4 frases: cifra, % comprometido, margen para la nueva cuota (estimación declarada) y confiabilidad de la cifra"
  },
  "recommendations": [{ "title": "paso corto", "detail": "1 a 2 frases: cómo aplicarlo en este caso" }]
}`;

const money = (v: number | null): string =>
  v === null ? 'sin dato' : `$${Math.round(v).toLocaleString('es-CO')} COP`;

const line = (label: string, value: string): string => `- ${label}: ${value}`;

/** Serializa el snapshot en texto compacto para el mensaje de usuario. */
export function buildBureauCheckUserMessage(
  input: BureauCheckPromptInput,
): string {
  const s = input.snapshot;

  const behavior =
    s.paymentBehavior.length > 0
      ? s.paymentBehavior
          .map((b) => `${b.month ?? '?'}: ${b.label ?? b.code ?? 'sin dato'}`)
          .join(' | ')
      : 'sin historial de comportamiento';

  const sectors =
    s.creditSectors.length > 0
      ? s.creditSectors
          .map(
            (c) =>
              `${c.sector ?? 'Sector sin nombre'} (vigentes: ${c.vigentes ?? '0'}, cerrados: ${c.cerrados ?? '0'}, saldo: ${money(c.saldoActual)}, mora: ${money(c.saldoMora)}, % deuda: ${c.porcentajeDeuda ?? 'sin dato'}, cuota mensual: ${money(c.valorCuota)}, como codeudor: ${money(c.totalCodeudorOtros)})`,
          )
          .join('\n  ')
      : 'sin créditos por sector reportados';

  const alerts =
    s.alerts.length > 0
      ? s.alerts
          .map((a) => `${a.message ?? ''}${a.date ? ` (${a.date})` : ''}`)
          .join('\n  ')
      : 'sin alertas reportadas';

  const suggestions =
    s.suggestions.length > 0
      ? s.suggestions
          .map((g) => `${g.title ?? 'Verificación'}: ${g.items.join('; ')}`)
          .join('\n  ')
      : 'sin sugerencias de verificación';

  return `TITULAR CONSULTADO: ${input.titularName ?? 'sin nombre'}

RESULTADO DE LA CONSULTA EN CENTRALES DE RIESGO:
${line('Puntaje (score)', s.score === null ? 'sin dato' : String(s.score))}
${line('Viabilidad según la central', s.viabilidad ?? 'sin dato')}
${line('Probabilidad de pago (narrativa de la central)', s.txtProbabilidad ?? 'sin dato')}
${line('Calificación de recaudo', s.ratingRecaudos ?? 'sin dato')}
${line('Nota de recaudo (narrativa de la central)', s.txtRecaudos ?? 'sin dato')}
${line('Saldo total de obligaciones', money(s.saldoActual))}
${line('Saldo en mora', money(s.saldoMora))}
${line('% de endeudamiento', s.porcentajeDeuda === null ? 'sin dato' : `${s.porcentajeDeuda}%`)}
${line('Cuota mensual total comprometida', money(s.valorCuota))}
${line('Obligaciones como codeudor/aval', money(s.totalCodeudorOtros))}
${line('Monto sugerido por la central', money(s.montoSugerido))}
${line('Ingreso mensual reportado', money(s.reportedIncome))}
${line('% del ingreso comprometido en cuotas', s.quotaToIncomePct === null ? 'sin dato' : `${s.quotaToIncomePct}%`)}
${line('Tendencia del endeudamiento', s.balanceTrend ?? 'sin dato')}

COMPORTAMIENTO DE PAGO MENSUAL:
  ${behavior}

CRÉDITOS POR SECTOR:
  ${sectors}

ALERTAS DE LA CENTRAL:
  ${alerts}

CHECKLIST DE VERIFICACIÓN SUGERIDO POR LA CENTRAL:
  ${suggestions}

SOLICITUD:
${line('Monto solicitado', money(input.requestedCreditLine))}
${line('Contraste con el monto sugerido', input.amountComparison.verdictLabel)}

Genera el análisis en el formato JSON indicado.`;
}
