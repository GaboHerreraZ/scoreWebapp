# Plan: Estudio de capacidad de pago (PN sin EEFF) — API + front cliente

## Contexto

Creditia hoy solo ofrece el estudio con estados financieros. El diseño aprobado en
[docs/estudio-persona-natural-diseno.md](../../Documents/Documentos%20Gabo/new%20project/webAppApi/docs/estudio-persona-natural-diseno.md) (v0.3)
y [docs/estudio-persona-natural-extraccion.md](../../Documents/Documentos%20Gabo/new%20project/webAppApi/docs/estudio-persona-natural-extraccion.md) (v0.2)
define el nuevo "Estudio de capacidad de pago": persona natural evaluada con
extractos bancarios + desprendibles de nómina (o facturas de contratista),
MiDecisor PN incluido, misma consulta del pack. Al crear un estudio, el usuario
elegirá el tipo: **capacidad de pago (PN)** o **con EEFF (PN/PJ)**.

Se trabaja **directo sobre staging** (rama y BBDD staging; sin BBDD aparte).
Decisiones del usuario: pesos del scoring **configurables por empresa desde v1**
e **informe PDF incluido en v1**.

## Decisiones estructurales

1. El estudio de capacidad **ES un `CreditStudy`** con discriminador nuevo
   `studyTypeId` (Parameter `study_type`: `financialStatements` | `paymentCapacity`).
   Razón: `AnalysisConsumption.creditStudyId @unique` (cobro 1:1), pagarés,
   tickets, resets y dashboards ya apuntan a `credit_studies`.
2. Mismo `POST /from-bureau` para crear (gate Zapsign → consulta MiDecisor →
   consumo de bolsa); gana `studyTypeCode` (default `financialStatements`).
3. Engine nuevo **puro** `runPaymentCapacityScoring()` que produce el MISMO shape
   `ScoringResult` → se reutilizan `viabilityConditions`, steps, export y front.
4. Documentos a **Supabase Storage** (bucket privado nuevo `study-documents`),
   no bytea. Movimientos bancarios normalizados como JSONB del documento (sin
   tabla de movimientos en v1).
5. Validaciones V1–V10 **determinísticas en código** (no en prompts).
6. Estados: se **reutiliza** la máquina `credit_status` actual
   (`pendingFinancialStatements` → `pendingStudyAnalysis` → `studyCompleted`…);
   el front remapea el label a "Pendiente de documentos" para capacidad.

## 1. Modelo de datos (una migración, staging)

**Parámetros nuevos** (INSERT `ON CONFLICT ("type","code") DO NOTHING`):
- `study_type`: `financialStatements`, `paymentCapacity`
- `study_document_type`: `bankStatement`, `payrollStub`, `contractorInvoice`
- `employment_type`: `salaried`, `independent`
- `ai_analysis_type`: `bankStatementPdfExtraction`, `payrollStubPdfExtraction`, `contractorInvoicePdfExtraction`

**`credit_studies`** — columnas nuevas:
- `study_type_id Int NOT NULL` (add nullable → backfill a `financialStatements` → NOT NULL) + FK + índice `(company_id, study_type_id)`
- `employment_type_id Int NULL` (FK Parameter), `declared_employment_start_date DATE NULL` (solo capacidad)

**`scoring_configurations`** — configurabilidad v1:
- `study_type_id Int NOT NULL` (add nullable → backfill a `financialStatements` → NOT NULL); índice de vigencia pasa a `(company_id, person_type_id, study_type_id, is_active)`
- Catálogo `scoring_dimensions`: **reusar** filas `paymentCapacity` y `centralRisk`; insertar 4 nuevas: `incomeStability`, `indebtedness`, `financialBehavior`, `docVeracity`

**Tabla nueva `study_documents`** (model `StudyDocument`): id, creditStudyId,
companyId, documentTypeId, fileName, fileSizeBytes, storagePath
(`companyId/creditStudyId/id.pdf`), extractionStatus (pending|success|error),
extractionError, aiAnalysisId, `extractedData Json` (schemas §2/§4/§5 del doc de
extracción, movimientos incluidos), `extractionFlags Json`,
`validationResults Json` (V intra-doc), `periodFrom/periodTo Date`,
`accountLast4`, uploadedBy, timestamps. Índices: creditStudyId, (companyId, createdAt).

**Tabla nueva `payment_capacity_analyses`** (model `PaymentCapacityAnalysis`,
`creditStudyId @unique`, upsert en cada perform): indicadores escalares
(verifiedMonthlyIncome, payrollNetIncome, bankStatementIncome,
incomeVerificationIndex, incomeCv, monthsWithIncome, windowMonths,
coveredMonths, paysOwnSocialSecurity, verifiedHireDate,
recurringFixedExpenses, existingDebtPayments, availableIncome,
maxSuggestedInstallment, payrollLoanCapacity, currentDti, projectedDti) +
bloques Json (behavior, monthlyIncomeSeries, detectedObligations,
crossValidations, reliabilityFlags).

**Manual en staging**: crear bucket privado `study-documents` + env
`SUPABASE_STORAGE_BUCKET_STUDY_DOCUMENTS`.

## 2. API (webAppApi) — módulo nuevo `src/payment-capacity/`

```
payment-capacity.module.ts
study-documents.controller.ts   // companies/:companyId/credit-studies/:creditStudyId/documents
study-documents.service.ts / .repository.ts
payment-capacity.service.ts     // perform + buildDocumentsStep (step2)
payment-capacity.repository.ts
dto/upload-study-document.dto.ts
engine/payment-capacity.{constants,types,engine}.ts   // runPaymentCapacityScoring puro
indicators/payment-capacity-indicators.ts             // §4 del diseño, puro + tests
indicators/movement-recurrence.ts                     // recurrencia, self-transfer, cuota probable
validation/document-validations.ts                    // V1–V10
validation/identity-match.ts                          // V5 difuso
pdf/payment-capacity-report.{mapper,template.html}    // informe PDF v1
```

Prompts nuevos en `src/ai/prompts/`: `bank-statement-extraction.prompt.ts`,
`payroll-stub-extraction.prompt.ts`, `contractor-invoice-extraction.prompt.ts`,
`payment-capacity-analysis.prompt.ts` (narrativa).

**Endpoints nuevos** (base `.../credit-studies/:creditStudyId/documents`):
- `POST /` multipart `{file, documentTypeCode}` → valida estudio capacidad no
  bloqueado + magic bytes + cardinalidad por tipo → sube a Storage → extracción
  IA síncrona (método nuevo `AiAnalysesService.extractStudyDocument`, registra
  `AiAnalysis` SIN pdfFile) → normaliza en código (año de fechas, locales,
  cédula) → validaciones intra-doc (extracto V1–V3, V6; nómina V8–V10) →
  persiste. Avanza a `pendingStudyAnalysis` cuando la cobertura mínima queda
  satisfecha. Respuesta con summary + coverage, nunca movimientos completos.
- `GET /` lista + coverage agregado. `GET /:documentId/file` → URL firmada.
  `DELETE /:documentId` (si no bloqueado; recalcula cobertura/estado).

**Cambios a existentes**:
- `CreateStudyFromBureauDto`: `studyTypeCode?`, `employmentTypeCode?`,
  `declaredEmploymentStartDate?` (requeridos con `paymentCapacity` vía
  `ValidateIf`). En `createFromBureau`: rechazo 400 si capacidad+NIT (antes del
  gate) y cinturón `personType === naturalPerson` tras el consult (antes de
  consumir bolsa).
- `performStudy`: branch inicial → `paymentCapacityService.perform(id, companyId, userId)`.
  Pipeline: docs success + riskSnapshot → validaciones cruzadas (V4 continuidad
  entre PDFs, V5 identidad, V7 cuenta nómina=extracto, índice de verificación,
  cobertura 3/6 meses) → `computePaymentCapacityIndicators()` → upsert análisis
  → resolver `ScoringConfiguration` vigente (companyId, personTypeId=PN,
  studyTypeId=paymentCapacity) o defaults → `runPaymentCapacityScoring()` →
  persistir igual que hoy (viabilityScore/Status/Conditions, recommendedCreditLine,
  scoringConfigurationId congelado, `studyCompleted`).
- `getSteps`: raíz gana `studyType {code,label}`; step2 discriminado (capacidad →
  documents + coverage + análisis, sin movimientos); step2 EEFF intacto.
- `findAll`/export Excel: incluir `studyType` (columna Tipo).
- `:id/pdf`: branch → mapper/plantilla de capacidad (Gotenberg, mismo PdfService).
- Narrativa: branch en `ai-analyses.service.analyze()` por studyType; se registra
  con typeId `creditReview` (steps la adjunta sin cambios).
- Scoring API: `GET/POST /scoring-configurations` gana query `studyType` (default
  `financialStatements`); `scoring.validation.validateWeights` valida el set de
  dimensiones según studyType (registro de reglas por tipo de estudio);
  `createVersion` desactiva la anterior del mismo (company, personType, studyType).
- Reset de soporte (`admin`): para capacidad, snapshot incluye documentos +
  análisis, limpia `PaymentCapacityAnalysis` y devuelve a paso 2 sin nueva consulta.

**Engine** — `runPaymentCapacityScoring(input): ScoringResult`. Dimensiones:
`paymentCapacity` 30, `centralRisk` 20, `incomeStability` 15, `indebtedness` 15,
`financialBehavior` 10, `docVeracity` 10 (defaults). Umbrales 75/40 y caps de la
central importados de `scoring.constants.ts`. Eliminatorias propias: ingreso
verificado = 0 o disponible ≤ 0. `approvedCreditLine.amount = min(solicitado,
cuotaMáxima × plazo/30)`. Resultado agrega bloque `capacityFigures` (ingreso
verificado, disponible, cuota máxima, DTI actual/proyectado, cupo libranza,
índice verificación); `pdfReliabilityFlags` = flags de extracción + validaciones
fallidas. Constantes de política v1: cuota máx = min(30% neto, 70% disponible);
DTI 30/45; verificación <0.9 flag; TRM implícita con banda 3.500–5.500 ±10%
(sin API de TRM en v1); apuestas >5% warning / >15% danger.

## 3. Front (webApp) — componentes nuevos, EEFF intacto

Rutas nuevas en `credit-study.routes.ts`: `estudio-capacidad` (crear) y
`estudio-capacidad/:id` (detalle). `detalle-estudio(/:id)` no se toca.

Componentes en `src/app/features/credit-study/payment-capacity/`:
- `study-type-selector/` — **diálogo** con 2 tarjetas (Empresarial EEFF /
  Capacidad de pago), abierto desde "Nuevo estudio".
- `payment-capacity-detail/` — contenedor creación+detalle, stepper Solicitud →
  Documentos → Resultado. Paso 1: PN-only (sin NIT), selector employment_type,
  fecha de inicio laboral declarada, cupo/plazo; `createFromBureau` con
  `studyTypeCode:'paymentCapacity'`; maneja `authorization_pending` igual que hoy.
- `payment-capacity-documents/` — paso 2: tarjetas por tipo según perfil
  (asalariado: extractos 3m + 2 nóminas; independiente: extractos 6m + facturas
  opcionales), medidor de cobertura, validaciones por documento, eliminar.
- `document-upload-card/` — control de upload PDF reutilizable (no existe hoy).
- `payment-capacity-result/` — paso 3: bloque capacityFigures + reutiliza
  `StudyResult` para veredicto/dimensiones/alertas/narrativa/central-risk
  (mismo `PerformStudyResponse`; secciones EEFF condicionadas con `@if`).

Servicio `payment-capacity.service.ts` (upload/list/delete/getFileUrl) y types
`src/app/types/payment-capacity.ts`; `CreateFromBureauPayload` y
`CreditStudyStepsResponse` extendidos en `types/credit-study.ts`.

Cambios mínimos a existentes:
- Listado `credit-study.ts`: columna Tipo + filtro; `onAdd()` abre el selector;
  routing del detalle por `studyType.code`; label de estado remapeado para capacidad.
- `dimension-config` (administración): eje de tipo de estudio (Empresarial:
  tabs PJ/PN como hoy; Capacidad de pago: solo PN) + query param `studyType`.
- `quick-actions`, `search.service`, `customer-credit-studies` (ficha PN),
  `recent-items.service` (ruta parametrizada), tour EEFF (paso del selector).
- NO tocar: `CreditStudyDetail`, `financial-statements`, `bureau-profile`,
  `promissory-note-modal`.

## 4. Hitos y verificación (todo en staging)

| Hito | Contenido | Verificación |
|---|---|---|
| M1 Esquema | Migración única + schema + studyTypeId en create/list/steps | Migración aplica; existentes = financialStatements; regresión E2E flujo EEFF completo; Excel OK |
| M2 Documentos | Bucket + endpoints documentos + 3 prompts + extractStudyDocument + validaciones intra-doc | Con las muestras reales: extracto Bancolombia → V1–V3 en verde (V2 cuadra exacto); nómina Globant → V8 exacto, cuenta ****0937; AiAnalysis sin pdfFile; DELETE limpia Storage |
| M3 Indicadores | Módulos puros + unit tests con fixtures de las muestras | Tests reproducen §6 del doc: ingreso ≈ $16.36M, CV ≈ 9%, self-transfer $6M excluida, FINESA $348.6k detectada, V5 "HERRERA ZAR"↔"Herrera Zárate", V7 ****0937 |
| M4 Engine+perform | Engine, perform branch, steps branch, PN-only, scoring config por studyType (API) | E2E API: crear capacidad → subir docs → perform → score coherente, bolsa 1:1, config congelada; regresión perform EEFF y config EEFF |
| M5 Narrativa+PDF | Prompt narrativa + branch analyze(); plantilla+mapper informe PDF capacidad | Narrativa coherente con §6; PDF descarga y renderiza; PDF EEFF intacto |
| M6 Front | Componentes, rutas, selector, listado, dimension-config con studyType, ganchos (quick-actions/search/recent/tour) | E2E UI staging con las muestras: wizard completo; listado rutea por tipo; tour EEFF pasa; config de dimensiones capacidad guarda y el perform la usa |
| M7 Endurecimiento | Reset de soporte para capacidad, hasPdfExtraction, Excel Tipo, lint+build+tests 3 proyectos | Reset re-habilita paso 2 sin consumir bolsa; builds limpios |

Commits solo tras revisión del usuario (memoria "no commit sin revisar").
Migración solo a STAGING (`prisma:migrate:create` + `prisma:migrate:deploy`);
PROD queda para cuando el usuario lo pida.

## 5. Riesgos vigilados

- Extractos largos → respuesta IA grande: `AI_MAX_TOKENS_EXTRACTION` alto,
  extracción por documento (nunca varios PDFs por llamada); si trunca en M2,
  fallback a 2 pasadas por rangos de páginas.
- Payloads: `extractedData.movements` jamás se serializa en steps/list (solo summary).
- Rutas hardcodeadas a `detalle-estudio` (6 sitios) — cubiertas en M6; el
  portal admin (consumos) puede necesitar `studyTypeCode` en su API (se expone
  desde M1, el front admin se ajusta solo si rompe).
- `paymentCapacity` existe como code en `scoring_dimensions` (se REUSA la fila,
  no se duplica); lookups de parámetros nuevos siempre por type+code.
- Reset de soporte: hasta M7, rechazar reset de estudios capacidad con mensaje claro.
