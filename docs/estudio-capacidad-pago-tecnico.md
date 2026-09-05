# Estudio de capacidad de pago — Documento técnico

> Audiencia: desarrolladores que mantienen o extienden el módulo.
> Complementa a `estudio-capacidad-pago-plan-implementacion.md` (el plan original)
> y a los docs de diseño/extracción. Este documento describe lo que quedó
> construido y **el porqué de cada pieza**.

## 1. Qué es

Estudio de crédito para **persona natural sin estados financieros** (asalariados
e independientes). En lugar de EEFF, la fuente de verdad es el **flujo de caja
real**: extractos bancarios + desprendible de nómina (asalariado) o facturas
opcionales (independiente), más la consulta a DataCrédito (MiDecisor PN).

Es un `CreditStudy` normal con `studyType = paymentCapacity`: comparte creación,
bolsas de consumo, pagarés, estados y front con el estudio EEFF. Lo que cambia
es el paso 2 (documentos en vez de EEFF) y el motor de scoring.

## 2. Principio rector de la arquitectura

**La IA decide qué ES cada cosa; el código decide CUÁNTO suma y si alcanza.**

| Responsabilidad | Quién | Por qué |
|---|---|---|
| Leer PDFs de cualquier banco | IA (extracción) | Imposible en código sin parsers por banco |
| Decidir si un abono es ingreso, traslado propio o plata de paso | IA (clasificación consolidada) | Es juicio semántico; requiere ver TODA la ventana |
| Verificar que la lectura fue fiel | Código (checksums V1–V3) | El verificador no puede ser el verificado: si la IA se auto-validara, una alucinación validaría otra |
| Promedios, CV, DTI, cuota máxima, score | Código (indicadores + engine) | Aritmética exacta, reproducible, testeable y defendible ante el cliente |
| Política de crédito (umbrales, pesos, eliminatorias) | Código (constantes + config por empresa) | Es la opinión de Creditia sobre el riesgo; debe ser determinística y configurable |
| Interpretar el resultado en prosa | IA (narrativa) | Lee los números finales; no puede cambiarlos |

Consecuencia práctica: si un cálculo sale raro, se puede reproducir a mano
(ej. promedio = total ÷ meses de la ventana). Si una clasificación sale rara,
el ledger `AiAnalysis` tiene la corrida exacta.

## 3. Mapa de módulos

```
src/payment-capacity/
├── study-documents.controller.ts   Endpoints de documentos
├── study-documents.service.ts      Upload → Storage → extracción → validación → cobertura
├── payment-capacity.service.ts     El perform (orquestador)
├── payment-capacity.repository.ts  Persistencia de PaymentCapacityAnalysis
├── coverage.ts                     [PURO] meses cubiertos, recencia, ¿se puede analizar?
├── classification/
│   └── movement-classification.ts  [PURO] payload de clasificación + validación estricta + apply
├── extraction/
│   ├── extraction.types.ts         Tipos de las 3 extracciones + taxonomía de categorías
│   └── normalize.ts                [PURO] frontera de desconfianza: JSON crudo IA → tipos
├── validation/
│   ├── document-validations.ts     [PURO] V1–V10 (checksums y cruces)
│   └── identity-match.ts           [PURO] match difuso de nombres/cédulas (V5)
├── indicators/
│   ├── payment-capacity-indicators.ts  [PURO] ingreso, DTI, disponible, cuota máxima…
│   └── movement-recurrence.ts          [PURO] series, obligaciones, señales de comportamiento
├── engine/
│   ├── payment-capacity.constants.ts   Política v1 (umbrales, pesos default, topes)
│   └── payment-capacity.engine.ts      [PURO] scoring 5 dimensiones → ScoringResult
└── pdf/                            Informe PDF (mapper + plantilla, render vía Gotenberg)

src/ai/
├── ai.service.ts                   Routing modelo→provider, perfiles por tipo de documento
├── providers/anthropic.provider.ts Streaming SDK (obligatorio con max_tokens grandes)
├── providers/gemini.provider.ts
└── prompts/
    ├── bank-statement-extraction.prompt.ts   Extracción de extractos + MOVEMENT_TAXONOMY
    ├── payroll-stub-extraction.prompt.ts
    ├── contractor-invoice-extraction.prompt.ts
    ├── movement-classification.prompt.ts     Clasificación consolidada (perform)
    └── payment-capacity-analysis.prompt.ts   Narrativa

src/ai-analyses/ai-analyses.service.ts  extractStudyDocument / classifyStudyMovements
                                        (ledger AiAnalysis: modelo, tokens, costo, error)
```

Los módulos marcados **[PURO]** no tienen IO ni Nest: reciben datos, devuelven
datos, y están cubiertos por tests unitarios. Toda la lógica de negocio vive ahí;
los services solo orquestan.

## 4. Modelo de datos

- **`CreditStudy`**: gana `studyTypeId` (Parameter `study_type`), `employmentTypeId`
  y `declaredEmploymentStartDate`. Todo lo demás (status, bolsa, pagaré) igual que EEFF.
- **`StudyDocument`**: una fila por PDF cargado. Guarda `extractedData` (JSONB con la
  extracción completa, movimientos incluidos), `extractionFlags`, `validationResults`,
  `periodFrom/To`, `accountLast4`, `extractionStatus` (pending|success|error).
  El binario vive en Supabase Storage (`study-documents/companyId/studyId/docId.pdf`).
- **`PaymentCapacityAnalysis`** (1:1 con el estudio, upsert en cada perform): los
  indicadores escalares + bloques JSON (behavior, monthlyIncomeSeries,
  detectedObligations, crossValidations, reliabilityFlags).
- **`AiAnalysis`** (ledger): una fila por corrida IA (extracción por documento,
  clasificación consolidada, narrativa) con modelo, tokens, costo estimado y error.

## 5. Carga de documentos

`POST /api/companies/:companyId/credit-studies/:creditStudyId/documents`
(multipart `file` + `documentTypeCode`). Límites: PDF de máx. 15 MB; cardinalidad
12 extractos / 2 desprendibles / 2 facturas (`MAX_BY_TYPE`).

Pasos del `upload()` y su porqué:

1. **`getCapacityStudy`** — el estudio existe, es de esta empresa y es de capacidad.
   *Pertenencia multi-tenant antes que nada.*
2. **Estado no bloqueado** — un estudio confirmado/cerrado no admite documentos.
3. **`assertProfileAllowsType`** — un asalariado no sube facturas ni un
   independiente desprendibles. *El perfil declarado define el set documental.*
4. **`assertCardinality`** — tope por tipo. *Cada documento cuesta una corrida IA.*
5. **Subir a Storage ANTES de crear la fila** — nunca una fila sin archivo.
6. **`extractAndValidate`**:
   - Extracción IA (una llamada por documento, perfil de modelo por tipo — ver §8).
   - `normalize.ts`: el JSON crudo del modelo pasa por la frontera de desconfianza
     (tipos, fechas ISO, números finitos). *Nada del modelo entra sin validar.*
   - Validaciones intra-documento (ver tabla §6).
   - Si la extracción falla, la fila queda en `error` (visible y borrable en el
     front) y no cuenta para cobertura.
7. **`refreshStudyProgress`** — recalcula cobertura; si quedó completa, el estudio
   avanza a `pendingStudyAnalysis`.

Endpoints hermanos: `GET /` (lista + cobertura), `GET /:id/file` (URL firmada 1h),
`DELETE /:id` (borra fila + binario y retrocede el estado si la cobertura se rompió).

## 6. Validaciones (todas deterministas, en código)

| Código | Qué verifica | Por qué existe |
|---|---|---|
| V1 | Saldo corrido fila a fila (saldo anterior + monto = saldo) | Detecta filas inventadas/omitidas por la IA **o** un PDF adulterado: un monto alterado rompe la cadena en esa fila |
| V2 | Checksum del resumen del banco (anterior + abonos − cargos = actual) | El banco ya hizo la suma; si no cuadra, la lectura o el documento están mal |
| V3 | Suma de movimientos vs totales del resumen | Complementa V1/V2: la transcripción completa cuadra contra el agregado |
| V4 | Continuidad de la serie (extractos consecutivos empalman saldos) | Anti-fraude: atrapa el "me salto el mes malo" y extractos fabricados |
| V5 | Identidad del titular en cada documento vs el consultado en la central | Los documentos deben ser DE la persona estudiada (match difuso: truncamientos, orden apellido/nombre) |
| V6 | Fechas dentro del período del encabezado | Movimiento fuera de período = lectura o documento sospechoso |
| V7 | La nómina se consigna en la MISMA cuenta del extracto | El cruce más fuerte del asalariado: papel y cuenta se corroboran |
| V8 | Devengos − deducciones = neto (nómina) / renglones = total (factura) | Aritmética interna del documento |
| V9 | Neto en letras = neto en número (nómina) | Un editor de PDF descuidado no cambia las dos representaciones |
| V10 | Identificación del empleado vs consultado | Refuerza V5 con la cédula |

Severidad: `danger` bloquea la confianza (el engine la pesa en docVeracity),
`warning`/`info` informan. Ninguna validación individual aborta el perform.

## 7. El perform, método a método

`POST /api/companies/:companyId/credit-studies/:id/perform` →
`CreditStudiesService.performStudy` detecta el tipo y delega en
`PaymentCapacityService.perform()`:

### 7.1 Recolectar extracciones (`findByStudyWithExtraction`)
Solo documentos `success`. *Un documento en error no puede contaminar el análisis.*

### 7.2 `computeCoverage`
Piso de **3 meses cubiertos** (`WINDOW_MONTHS_*`, es piso, no tope), documento de
ingreso para asalariado (mín. 1 desprendible), recencia del último corte
(≤ 45 días, `STATEMENT_RECENCY_DAYS`; si no, flag — no bloquea). Un mes cuenta
solo si el extracto lo cubre casi completo (umbral en `monthsInRange`): un mes a
medias inflaría la cobertura y desinflaría el ingreso mensual. Si no está
completa → 400 con el detalle exacto de lo que falta.

### 7.3 Validaciones cruzadas
`validateSeriesContinuity` (V4), `validateIdentity` (V5 global) y
`validateDepositAccountMatch` (V7). Cruzan **entre** documentos, por eso viven en
el perform y no en el upload (necesitan verlos todos).

### 7.4 Clasificación consolidada (el paso IA del perform)
Problema que resuelve: cada PDF se extrae por separado, así que sus categorías
son borradores sin panorama — el mismo "Honorarios" puede ser ingreso en un mes
y unknown en otro. Solución: **una sola llamada** (`AI_CLASSIFICATION_MODEL`)
con TODOS los movimientos de TODOS los extractos + perfil declarado + resumen de
facturas aportadas → categoría definitiva por movimiento con un único criterio
(recurrencia entre meses e intra-mes, plata de paso ±7 días, PAN de tarjetas,
plataformas de inversión, el perfil manda sobre la duda del ingreso).

Cinturones:
- `parseClassifications` valida con desconfianza: todos los índices exactamente
  una vez, categorías del catálogo. Cualquier defecto → se descarta TODA la respuesta.
- `applyClassifications` solo toca `category`; montos/fechas/saldos (verificados
  por V1–V3) son intocables.
- Si la llamada falla → **fallback a los borradores** + flag de advertencia.
  La clasificación nunca bloquea el perform.
- La corrida queda en el ledger (`ai_analysis_type = movementClassification`).

### 7.5 `computePaymentCapacityIndicators` (código puro)
Sobre los movimientos ya clasificados:

- **Serie de ingreso mensual**: abonos de categorías de ingreso, excluyendo
  traslados propios, plata de paso y avances de TC (deuda nueva no es ingreso).
- **Ingreso verificado**: para el independiente, el promedio de la serie. Para el
  asalariado, el neto de nómina **contrastado** contra lo que llega a la cuenta
  (índice de verificación); si no se identifica el abono de nómina, manda el
  extracto — es la misma cuenta sobre la que se miden los egresos.
- **CV y meses con ingreso**: estabilidad (un independiente "grumoso" es riesgo real).
- **Obligaciones detectadas** (`detectObligations`): por recurrencia de
  contraparte normalizada; expone total del período + desglose mensual +
  promedio = total ÷ meses de la ventana (reproducible a mano — lección del
  caso ADDI).
- **Gastos fijos recurrentes** y **costo de vida** observados.
- **Disponible** = ingreso − fijos − cuotas. **Cuota máxima** =
  min(30% del ingreso, 70% del disponible) (`MAX_INSTALLMENT_*`).
- **DTI sin tarjeta**: el pago de TC del extracto no distingue pago mínimo de
  pago total, así que la tarjeta resta del disponible pero no entra al DTI
  (entraría con doble filo). Umbral 30% sano / 45% crítico.
- **Señales de comportamiento**: días en negativo, % retirado en las 48h
  siguientes al abono, apuestas (5%/15% del ingreso), avances de TC, colchón.
- **Cruce factura↔abono**: COP busca un abono individual que corresponda al
  total (hasta −15% por retenciones); moneda extranjera valida TRM implícita en
  banda 3.500–5.500 ±10%. Factura de un mes fuera de la ventana → info, no warning.

### 7.6 Upsert de `PaymentCapacityAnalysis`
Todo el análisis persiste ANTES del scoring: si el engine cambiara mañana, los
indicadores históricos siguen ahí para re-evaluar o auditar.

### 7.7 Configuración de scoring
Se resuelve la `ScoringConfiguration` vigente de (empresa, PN, paymentCapacity)
o los defaults, y **se congela** en el estudio (`scoringConfigurationId`): un
estudio viejo siempre puede explicarse con los pesos que lo produjeron.

### 7.8 `runPaymentCapacityScoring` (engine puro)
**5 dimensiones** (pesos default, configurables por empresa):

| Dimensión | Peso | Qué mide |
|---|---|---|
| incomeStability | 25 | Meses con ingreso, CV, recencia |
| indebtedness | 25 | DTI actual (y proyectado si hay plazo) |
| centralRisk | 20 | Señal de MiDecisor (reutiliza `evalCentralRisk` del engine EEFF) |
| financialBehavior | 15 | Días en rojo, retiros 48h, apuestas, avances, colchón |
| docVeracity | 15 | Validaciones V* superadas/falladas |

No hay dimensión "capacidad de pago": la capacidad actúa como **eliminatoria**
(ingreso verificado = 0 o disponible ≤ 0 → rechazo directo) y como **cifra
operativa** (cuota máxima en `capacityFigures`). Una dimensión no evaluable
(central sin historia) redistribuye su peso entre las demás — no castiga al
cliente por falta de dato externo. Umbrales de veredicto compartidos con EEFF:
≥75 aprobado, ≥40 condicional.

Devuelve el mismo shape `ScoringResult` del estudio EEFF → steps, front,
narrativa y PDF reutilizan toda la anatomía del resultado.

### 7.9 Cierre
Persiste score/veredicto/condiciones, estado → `studyCompleted`. Narrativa
(`payment-capacity-analysis.prompt`, lee los números, no los cambia) e informe
PDF (mapper + plantilla propia, render Gotenberg) disponibles desde el paso 3.

## 8. Configuración IA

- **Routing por modelo**: cualquier override `claude-*` va al provider Anthropic
  y `gemini-*` al de Gemini, sin importar `AI_PROVIDER` global.
- **Perfiles por tipo**: `AI_EXTRACTION_MODEL_<TIPO>` / `AI_MAX_TOKENS_<TIPO>`
  (`BANK_STATEMENT`, `PAYROLL_STUB`, `CONTRACTOR_INVOICE`, `FINANCIAL_STATEMENTS`);
  fallback a `AI_EXTRACTION_MODEL` / `AI_MAX_TOKENS_EXTRACTION`.
- **Clasificación**: `AI_CLASSIFICATION_MODEL` / `AI_MAX_TOKENS_CLASSIFICATION`
  (fallback a los de extracción).
- Staging/prod actual: extractos y clasificación en `claude-opus-5` (48k/16k de
  presupuesto — el razonamiento del modelo cuenta dentro del límite); nómina,
  factura, EEFF y narrativa en Gemini.
- El provider Anthropic usa **streaming** siempre: el SDK rechaza llamadas
  no-streaming que puedan superar 10 min (max_tokens grandes).
- `SUPABASE_STORAGE_BUCKET_STUDY_DOCUMENTS` para el bucket de documentos.

## 9. Decisiones de diseño (para no re-litigarlas sin contexto)

1. **Transcripción por documento + clasificación global** ("copy vs judge"):
   transcribir no necesita panorama y así el usuario tiene feedback inmediato al
   subir; clasificar sí lo necesita y por eso se re-decide en el perform con
   todos los meses. No fusionar en una sola llamada gigante.
2. **Checksums en código, nunca en prompts**: independencia del verificador.
3. **Multi-documento se mantiene** (máx. 12 extractos): no todos los bancos
   emiten trimestral (Caja Social emite mensual); obligar a 1 PDF forzaría
   fusiones caseras que rompen V2 (varios bloques de resumen en un archivo) y
   debilitan el anti-fraude. V4 existe precisamente porque hay serie.
4. **El extracto manda sobre el papel**: si el neto de nómina no se ve llegar a
   la cuenta, el ingreso se toma de los abonos verificados.
5. **Evolución prevista**: si las heurísticas de código (regex de avances,
   detección de obligaciones, listas de apuestas) fallan con bancos nuevos, la
   jugada es ampliar la clasificación consolidada para que también marque esa
   semántica ("es cuota", "es compromiso fijo", "es apuesta") — no acumular
   más regex. Igual que se hizo con las categorías.

## 10. Dónde tocar qué

| Quiero cambiar… | Archivo |
|---|---|
| Umbrales de política (DTI, cuota máxima, apuestas, recencia, topes de docs) | `engine/payment-capacity.constants.ts` |
| Pesos default / reglas de dimensiones | `engine/payment-capacity.constants.ts` |
| Cómo se evalúa una dimensión | `engine/payment-capacity.engine.ts` |
| Una validación documental | `validation/document-validations.ts` |
| Categorías de movimientos o reglas de clasificación | `MOVEMENT_TAXONOMY` en `bank-statement-extraction.prompt.ts` (compartida) y reglas en `movement-classification.prompt.ts` |
| Qué extrae la IA de un PDF | El prompt del tipo en `src/ai/prompts/` + `extraction.types.ts` + `normalize.ts` |
| Un indicador | `indicators/payment-capacity-indicators.ts` o `movement-recurrence.ts` |
| Modelo/presupuesto IA | Variables de entorno (§8), sin tocar código |

**Antes de cualquier cambio**: correr `npm test` (los specs de indicadores,
engine, clasificación, validaciones y cobertura fijan el comportamiento actual;
si un cambio rompe un test, el test te está contando una decisión de diseño).
