// Prompt de extracción de EXTRACTOS BANCARIOS (estudio de capacidad de pago).
// Contrato de salida: BankStatementExtraction + extractionFlags
// (src/payment-capacity/extraction/extraction.types.ts, espejo del doc
// docs/estudio-persona-natural-extraccion.md §2 y §3). Principios (§7): el
// prompt EXTRAE (no calcula indicadores), incluye el saldo corrido de cada
// movimiento (es lo que permite validar en código), y `unknown` es respuesta
// válida — prohibido inventar categorías o contrapartes.

/**
 * Taxonomía de categorías compartida por la EXTRACCIÓN (borrador por documento)
 * y la CLASIFICACIÓN consolidada (una llamada con toda la ventana). Una sola
 * fuente de verdad: si se agrega una categoría, ambos prompts la ven.
 */
export const MOVEMENT_TAXONOMY = `## CATEGORÍAS (elige la MÁS específica; en duda, "unknown")

- income_international: transferencias internacionales recibidas (ej. "TRANSF INTERNACIONAL RECIBIDA").
- income_payroll: abonos de nómina (ej. "PAGO NOMINA", "ABONO NOMINA").
- income_other: otros abonos recurrentes de terceros que parezcan ingreso.
- self_transfer_in / self_transfer_out: movimiento entre cuentas del PROPIO titular. Tres casos:
  (a) la descripción nombra al titular del encabezado (ej. "TRANSF DE GABRIEL HER" si el titular es Gabriel Herrera);
  (b) traslado DENTRO DEL MISMO BANCO que NO nombra a ningún beneficiario, es decir describe solo el canal (ej. "TRANSFERENCIA CTA SUC VIRTUAL"). Mover plata entre bolsillos propios es lo más probable y NO es un gasto: si nadie está nombrado, NO lo trates como pago a un tercero;
  (c) traslados hacia plataformas de inversión del propio titular (Tyba, trii, a2censo, alcancías digitales, "ingreso de dinero hacia" una plataforma): es ahorro propio moviéndose, no gasto ni pago a un tercero. Y al revés: un abono que REGRESA de esas plataformas es plata propia, NO ingreso.
  EXCEPCIÓN: si la descripción nombra la TARJETA DE CRÉDITO ("TC", "TARJETA CREDITO", "AVANCE"), NO es traslado propio. "TRANSFERENCIA TC SUC VIRTUAL" se parece a "TRANSFERENCIA CTA SUC VIRTUAL" pero significa lo contrario: la plata sale de un cupo de crédito, no de otra cuenta del titular → cc_cash_in.
- wallet_transfer: transferencias hacia billeteras (Nequi, Daviplata).
- cc_payment: pagos de tarjeta de crédito (ej. "PAGO SUC VIRT TC MASTER", "PAGO PSE Banco de X" cuando es pago de TC). Una referencia de 16 dígitos que empiece por 4, 5 o 2221–2720 es un NÚMERO DE TARJETA: un débito contra esa referencia (ej. "COMPRA INTERNET 5409995451119268") es el pago de esa tarjeta, no una compra — un comercio jamás muestra el número completo.
- cc_cash_in: ABONOS que vienen de una tarjeta de crédito — avances, disposición de efectivo o traslados del cupo hacia la cuenta (ej. "TRANSFERENCIA TC SUC VIRTUAL", "AVANCE TC"). Es deuda nueva entrando, NUNCA ingreso. Una devolución ("SALDO A FAVOR TARJETA CREDITO") NO es avance: va en interest.
- loan_payment: cuotas de créditos a financieras/fintech (ej. "PAGO PSE FINESA S.A.", "PAGO PSE P.A. ADDI").
- social_security: aportes a seguridad social (ej. "PAGO PSE APORTES EN LINEA", "SOI").
- pension_savings: ahorro voluntario/pensión (ej. "PAGO PSE Multitrust SKANDIA").
- utilities: servicios públicos (energía, agua, gas, aseo). Ej. "PAGO PSE EPM", "CODENSA", "VANTI", "ACUEDUCTO", "AIR-E", "AFINIA".
- telecom: telefonía, internet y TV (Claro, Movistar, Tigo, ETB, WOM, DirecTV).
- health: la CUOTA de salud prepagada, EPS, medicina prepagada o pólizas de salud (Colsanitas, Medisanitas, Sura, Compensar, Coomeva, Famisanar, Nueva EPS, Colmédica). NO confundir con social_security (aportes PILA). Una compra en droguería o farmacia ("COMPRA EN DROGUERIA", "LA REBAJA", "CRUZ VERDE", "FARMATODO") NO es health: es purchase.
- education: la PENSIÓN o matrícula de un colegio, universidad o jardín, y solo cuando la descripción nombre la institución. "COMPRA EN FUNDACION" o "COMPRA EN INSTITUTO" truncados NO alcanzan: eso es purchase.
- insurance: seguros que no son de salud (vida, vehículo, hogar) — ej. "SEGUROS BOLIVAR", "SURA SEGUROS", "MAPFRE".
- rent: arriendo, SOLO cuando la descripción lo dice explícitamente ("ARRIENDO", "CANON"). Un arriendo pagado por transferencia sin decirlo NO es identificable: ese va en recurring_transfer_out.
- subscription: suscripciones de entretenimiento y software (Netflix, Spotify, Disney, iCloud, ChatGPT).
- groceries: mercado y supermercados (Éxito, Carulla, Jumbo, Olímpica, D1, Ara, Ísimo, Makro, Alkosto cuando es mercado).
- transport: transporte y movilidad (gasolina/EDS, peajes, Uber, DiDi, Cabify, recargas de TransMilenio/Metro).
- purchase: el resto de compras y pagos QR ("COMPRA EN…", "PAGO QR…") que no encajen en groceries ni transport. Es la categoría correcta cuando el comercio viene truncado y no se puede identificar ("COMPRA EN BUCARAMANG", "COMPRA EN LA SERRANI"): fue una compra aunque no se sepa dónde.
- atm_withdrawal: retiros en cajero.
- recurring_transfer_out: salidas hacia OTRA entidad ("TRASLADO VIRTUAL OTROS BANCOS") o transferencias a un tercero NOMBRADO ("TRANSF A GLOBAL COLOMBIA 81", "TRANSF A LEIDY SANCHE") que no encajen arriba. Si el traslado es interno y sin beneficiario, va en self_transfer_out.
- bank_fee: cuotas de manejo y comisiones.
- tax: impuestos (4x1000, IVA de comisiones).
- interest: abonos/ajustes de intereses de la cuenta y saldos a favor de TC.
- gambling: casas de apuestas (BetPlay, Wplay, Rushbet, Codere…).
- unknown: no clasificable con seguridad. NUNCA inventes.

## REGLA DEL CANAL: "COMPRA EN…" es consumo, no compromiso fijo

Los bancos truncan el nombre del comercio a unos 12 caracteres, así que muchas descripciones quedan a medias. Ante la duda, pesa el CANAL:

- "COMPRA EN…" y "PAGO QR…" son consumo en datáfono → purchase (o groceries/transport si el comercio es inequívoco). NUNCA los mandes a health, education, insurance, telecom, utilities ni rent: un compromiso contractual no se paga por datáfono.
- Los compromisos fijos llegan por otro canal — "PAGO PSE…", "TRANSF A…", débito automático o descuento — y ahí sí nombran a la empresa ("PAGO PSE Electrificadora", "PAGO PSE COLSANITAS").
- "COMPRA INTERNET" NO es datáfono: es pago por portal y SÍ puede ser un compromiso. Júzgalo por la referencia y el texto: "Planilla Integrada"/PILA → social_security, "Medicina Prepagada" → health, referencia de 16 dígitos tipo tarjeta → cc_payment; sin ninguna señal, purchase.

Esto importa: los compromisos fijos se descuentan del ingreso disponible del titular y el consumo no. Clasificar una compra de $250.000 como colegio le resta capacidad de pago a alguien que solo fue de compras.`;

export function buildBankStatementExtractionPrompt(): string {
  return `Eres un extractor de datos de EXTRACTOS BANCARIOS colombianos en PDF. Tu única salida es un JSON válido, sin texto adicional ni bloques de código.

## QUÉ EXTRAER

1. **Cuenta** (encabezado): banco emisor, tipo de cuenta ("savings" ahorros, "checking" corriente, "wallet" billetera tipo Nequi/Daviplata), últimos 4 dígitos del número de cuenta, nombre del titular TAL CUAL aparece (aunque venga truncado o con caracteres extraños — no lo corrijas), sucursal.
2. **Período** (encabezado DESDE/HASTA): fechas ISO (YYYY-MM-DD). Un solo PDF puede cubrir VARIOS meses (p. ej. Bancolombia emite el de ahorros trimestral).
3. **Resumen** (bloque RESUMEN del banco): saldo anterior, total abonos, total cargos (valor absoluto), saldo actual, saldo promedio, intereses pagados, retención. EXTRÁELOS tal cual — no los calcules tú. Si un valor no aparece, null.
4. **Movimientos**: TODOS los renglones de la tabla, en orden. Por cada uno:
   - date: fecha ISO. Las fechas del extracto suelen venir SIN año (ej. "22/04"): resuelve el año contra el período del encabezado.
   - rawDescription: la descripción tal cual.
   - amount: monto CON SIGNO (abono positivo, cargo negativo).
   - balance: el SALDO CORRIDO tras el movimiento (columna SALDO). NUNCA lo omitas ni lo calcules: extráelo. Es la clave de la validación posterior.
   - category: UNA de las categorías de abajo. Es un BORRADOR: la clasificación definitiva se decide después viendo todos los meses juntos, así que ante la duda prioriza transcribir bien y usa "unknown".
   - counterparty: la contraparte si es identificable en la descripción ("NEQUI", "FINESA S.A.", "SKANDIA", "NETFLIX", nombre de una persona…), si no null.

${MOVEMENT_TAXONOMY}

## FLAGS DE EXTRACCIÓN

Reporta en extractionFlags todo lo que comprometa la confiabilidad de la lectura: páginas ilegibles, renglones truncados, columnas ambiguas, montos dudosos, período incompleto. Formato: {"severity": "danger"|"warning"|"info", "category": "legibilidad"|"periodo"|"cuadre"|"identidad"|"otro", "title": "…", "detail": "…"}. Si no hay problemas, [].

## SALIDA (JSON EXACTO)

{
  "docType": "bank_statement",
  "account": { "bank": "…", "accountType": "savings", "accountNumberLast4": "0937", "holderName": "…", "branch": "…" },
  "period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "summary": { "previousBalance": 0, "totalCredits": 0, "totalDebits": 0, "finalBalance": 0, "averageBalance": null, "interestPaid": null, "withholding": null },
  "movements": [ { "date": "YYYY-MM-DD", "rawDescription": "…", "amount": -318400.00, "balance": 7340788.84, "category": "wallet_transfer", "counterparty": "NEQUI" } ],
  "extractionFlags": []
}

Reglas finales: números como números JSON (sin separadores de miles; el punto es decimal). Extrae TODOS los movimientos aunque sean cientos. No agregues campos. No calcules totales ni promedios propios.`;
}
