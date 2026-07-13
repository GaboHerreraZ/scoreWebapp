# Modelo de scoring v2 — 7 dimensiones + configuración versionada

> **Estado: IMPLEMENTADO** (Hitos 1-4). Este es el documento autoritativo del
> análisis del estudio de crédito. Reemplaza al modelo de 5 dimensiones de
> [`credit-study-viability-model.md`](./credit-study-viability-model.md), que
> queda **OBSOLETO** (conservado solo como referencia histórica).
>
> El modelo rediseña el análisis ahora que existen dos fuentes de EEFF (PDF +
> DataCrédito) y datos nuevos de la central (score, monto sugerido, nivel de
> riesgo). Ver §11 para el estado real de implementación (qué se construyó y qué
> difiere de la propuesta original).

---

## 1. Qué cambió respecto al modelo actual

El modelo actual (5 dimensiones × 20 = 100) se basaba en **una sola fuente**: los
EEFF que el usuario ingresaba a mano. Ahora hay tres insumos nuevos:

1. **EEFF de DataCrédito** — además del PDF, se extraen de la consulta MiDecisor.
2. **Opinión de la central** — Experian entrega `puntajeScore`, `montoSugerido`,
   `nivel` de riesgo y `ratingSectorial`.
3. **Posibilidad de contraste** — comparar PDF vs DataCrédito para detectar
   estados financieros **maquillados**.

Esto obliga a: (a) elegir sobre qué fuente corre el cálculo, (b) agregar
dimensiones nuevas, (c) hacer los pesos configurables por empresa.

---

## 2. Decisiones tomadas (autoritativas)

| Tema | Decisión |
|------|----------|
| **Fuente de cálculo** | **DataCrédito** (fuente de verdad, no maquillable). Fallback a PDF si el cliente no tiene EEFF en la central. |
| **Rol del PDF** | Insumo del **contraste** (detección de maquillaje), ya no del cálculo. |
| **Dimensiones** | Las 5 actuales + **Dim 6 Veracidad** + **Dim 7 Riesgo de la central** = 7. |
| **Dim 6 (Veracidad)** | Maquillaje penaliza la dimensión (no elimina). Umbrales: >10% warning, >25% danger. |
| **Dim 7 (Riesgo central)** | Dimensión propia. Se apoya en lo que Experian ve y **nosotros no** (nivel/rating/comportamiento de pago), NO en la salud del balance (evita doble conteo con Dim 1). |
| **Score total** | **Pesos por importancia** (no ×20 uniforme), suman 100. |
| **Pesos** | **Configurables por empresa**, versionados en el tiempo. |
| **Config por estudio** | El `scoringConfigurationId` vigente se graba en el `CreditStudy` **al realizar el análisis** (congelación por referencia). |
| **Peso mínimo** | Cada dimensión tiene un piso (p. ej. 5); nadie puede apagar la veracidad. |
| **Umbrales de veredicto** | Fijos (≥75 approved, ≥40 conditional). Solo los pesos se configuran. |

---

## 3. Consecuencia técnica clave: EBITDA sobre DataCrédito = EBIT

Experian **no desglosa** depreciación/amortización (van embebidas en gastos). En
las cifras de DataCrédito, `depreciation` y `amortization` quedan en **0**, así
que el `ebitda` calculado sobre DataCrédito es en realidad un **EBIT** (no suma
D&A de vuelta).

**Esto es deseable, no un bug:** hace que la capacidad de pago sobre la fuente de
verdad sea **más conservadora**. Debe documentarse para que nadie "arregle" ese 0.

- Impuestos **sí** los trae Experian ("Gasto o ingreso por impuestos") → se puede
  mapear (falta agregarlo al diccionario del mapper).
- D&A **no** son recuperables de las cifras de Experian (no hay identidad
  contable que las despeje). Se quedan en null/0 para DataCrédito.

**Regla del contraste:** solo se comparan **métricas homogéneas** entre fuentes.
El EBITDA NO se contrasta directamente (PDF lo tiene con D&A, DataCrédito sin
D&A). Se contrastan cifras crudas gruesas (ver Dim 6).

---

## 4. Las 7 dimensiones

Las dimensiones 1-5 conservan su lógica (ver documento base); ahora corren sobre
las cifras de **DataCrédito**.

| # | Dimensión | Mide | Fuente |
|---|-----------|------|--------|
| 1 | Salud financiera (Z-Altman) | Solidez del balance | DataCrédito |
| 2 | Capacidad de pago | Puede pagar la cuota | DataCrédito |
| 3 | Coherencia de plazos | Si el plazo cubre su ciclo de cobro (tensión de caja del cliente, no riesgo de impago) | DataCrédito |
| 4 | Adecuación del cupo | El cupo cabe en su capacidad **y** en el techo de la central | DataCrédito |
| 5 | Exposición del capital | Interés del prestamista (crédito sin interés) | DataCrédito |
| 6 | **Veracidad** *(nueva)* | Coincidencia PDF vs DataCrédito | Contraste |
| 7 | **Riesgo de la central** *(nueva)* | Reputación crediticia / comportamiento | DataCrédito (Experian) |

### 4.1 Dim 6 — Veracidad (contraste PDF ↔ DataCrédito)

Compara las **cifras crudas gruesas** del **mismo año** (emparejadas por
`fiscalYear`; nunca años distintos) entre el PDF y DataCrédito:

- Ingresos operacionales
- Activo total
- Pasivo total
- Patrimonio
- Utilidad neta

Para cada cifra: `diff = |PDF − DataCrédito| / DataCrédito`.

| Peor discrepancia | Estado | Puntaje |
|-------------------|--------|--------:|
| < 10% en todas | `consistent` | full |
| 10%–25% en alguna | `discrepant` (warning) | parcial |
| > 25% en alguna | `manipulated` (danger) | 0 |

- **No elimina** el estudio (decisión tomada), pero un `manipulated` deja la
  dimensión en 0 y genera una alerta `danger` visible.
- **Cuando falta una fuente, el trato DEPENDE del tipo de persona** (⚠️ regla
  clave, corregida): la Veracidad necesita **ambas** fuentes (PDF + EEFF de la
  central) para contrastar. Si falta una:
  - **PJ (persona jurídica):** la empresa **está obligada** a reportar sus EEFF a
    la central. Si no hay con qué contrastar (típicamente: la central no tiene
    EEFF de la empresa), **NO se exime** — no pudimos verificar que digan la
    verdad → la Veracidad puntúa **0** (`status: 'unverifiable'`, alerta
    `danger`). Su peso NO se redistribuye: cuenta como 0 en el score. Esto es
    distinto de un maquillaje detectado, pero igual de penalizado: no hay
    respaldo. **En PJ la Veracidad SIEMPRE es evaluable.**
  - **PN (persona natural):** la central **no reporta** EEFF de PN, así que nunca
    hay contraste posible → la Veracidad **no aplica** (`not_evaluable`), su peso
    se **redistribuye** (ver §6.3) y por config nace en 0.
- Experian reporta con rezago (primeros 10 días del mes) → una discrepancia menor
  puede ser desfase temporal, por eso el umbral de warning arranca en 10%.

### 4.2 Dim 7 — Riesgo de la central

Usa la opinión de Experian que **nosotros no podemos derivar** de los EEFF:
`nivel` de riesgo, `ratingSectorial`, comportamiento de pago (mora/historial).
**No** usa la salud del balance (eso ya lo mide Dim 1 → evita doble conteo).

**Fórmula rica.** ⚠️ **La implementación final usa el `puntajeScore` (150-950)
mapeado a bandas** como base (más granular que el `nivel`), penalizado por sector
y mora — ver §11 para la tabla de bandas definitiva. El `nivel` quedó como
respaldo si no viene score. El esquema conceptual (base − penalizaciones) es:

```
base = puntajeScore → banda (§11):  ≥750 → 1.0 ... <500 → 0.0
       (respaldo sin score: nivel BAJO → 0.9 | MEDIO → 0.5 | ALTO → 0.1)
penalización sectorial: si ratingSectorial ∈ {ALTO, 4, 5} → −0.15
penalización por mora:  GRADUADA por severidad × recencia (ver abajo);
                        hasta −0.40 en el peor caso
penalización por over-ask: si el cupo solicitado supera el montoSugerido
                        de la central → −0.15
ratio_7 = clamp(base − penalizaciones, 0, 1)
```

**Mora graduada (severidad × recencia).** El vector de comportamiento de pago de
la central trae un código por mes: `N` (al día), `1`..`6` (mora de 30..180 días),
`C` (cartera castigada), `D` (dudoso recaudo). En vez de un booleano "hay
mora → −0.15" fijo, se calcula un **índice ponderado 0..1**:

- Cada código tiene una severidad: `1`→0.30, `2`→0.45, `3`→0.60, `4`→0.75,
  `5`→0.90, `6`/`C`/`D`→1.00 (constante `ARREARS_SEVERITY`).
- Los **meses recientes pesan más** (ventana de 6 meses con factor creciente):
  mora severa hace 2 meses castiga mucho; la misma mora hace 13 meses, seguida
  de meses al día, castiga poco (**mora superada no persigue al cliente**).
- Penalización a la Dim 7 = `índice × 0.40` (tope `ARREARS_MAX_PENALTY`).
- El índice también dispara red flags: ≥ 0.5 → `danger` ("mora severa y
  reciente"), ≥ 0.2 → `warning`, con el detalle del peor mes ("mora de 180 días
  en 2025-6").

Ejemplo real (Servientrega): vector `6,3,4` hace ~13 meses + 9 meses en `N` →
índice 0.15 → penalización 0.06 y sin red flag (mora antigua ya normalizada).
El mismo `6,6,6` en los últimos 3 meses → índice 0.36 → penalización 0.14 + flag.

### 4.3 El `montoSugerido` de la central como techo del cupo

La central devuelve un `montoSugerido`: el monto **máximo que Experian avala**
para el cliente. Antes era solo referencia; ahora es un **techo duro** que
interviene en el análisis (aplica igual a **PN y PJ**):

1. **Dim 4 (Adecuación del cupo)** ahora toma el **peor** de dos techos: lo
   pagable según su capacidad y plazo **Y** el `montoSugerido`. Basta con violar
   uno para que el cupo sea inadecuado. El exceso se gradúa: ≤ techo → 1.0;
   ≤ techo × 1.3 → 0.6 (warning); > techo × 1.3 → 0.0 (danger).
2. **Dim 7 (Riesgo de la central)** suma una penalización de −0.15 cuando el cupo
   solicitado supera el `montoSugerido` (el cliente pide más riesgo del que la
   central le reconoce).
3. **Monto aprobado por Creditia** (`recommendedCreditLine`): no lo calculamos con
   fórmula propia. Es el cupo solicitado si respeta el techo, o el `montoSugerido`
   cuando el cliente pide de más. **Nunca aprobamos por encima del techo de la
   central.** Se persiste en la columna `recommended_credit_line` y en el bloque
   `approvedCreditLine` del JSON de viabilidad:

   ```json
   "approvedCreditLine": {
     "amount": 85000000,           // lo que Creditia avala
     "requested": 120000000,       // lo que pidió el cliente
     "suggestedByBureau": 85000000,// techo de la central (montoSugerido)
     "cappedByBureau": true        // se recortó al techo
   }
   ```

4. **`montoSugerido` distingue `null` de `0`**: `null` = no hubo consulta a la
   central → no hay techo, se avala lo pedido. `0` = la central avala **CERO**
   → techo real 0 (`amount: 0`, Dim 4 en 0) **y además es eliminatorio**
   (`rejected`, ver §6.2): la central no lo reconoce como sujeto de crédito.

### 4.4 Dim 3 — Coherencia de plazos (tensión de caja, NO riesgo de impago)

Compara el **plazo que el cliente pide** para pagarle a Creditia contra su
**rotación de cartera** (los días que él tarda en cobrarle a SUS clientes). La
lectura correcta es desde la **caja del cliente**:

- **Plazo ≥ rotación** → el cliente cobra ANTES de tener que pagarnos → su caja
  soporta el crédito sin tensión (`comfortable`, ratio 1).
- **Plazo < rotación (brecha manejable, ≥ 70%)** → paga antes de cobrar; debe
  cubrir la brecha con su capital de trabajo (`tight`, ratio 0.5, warning).
- **Plazo muy inferior** → alta tensión de liquidez (`strained`, ratio 0,
  warning).

> ⚠️ **Corrección conceptual**: la versión anterior llamaba a esto "riesgo de
> incumplimiento", lo cual estaba **invertido**: que el cliente nos pague rápido
> es MÁS seguro para Creditia, no menos. Lo que se penaliza es la **tensión de
> liquidez del cliente** (puede derivar en pago tardío si no tiene colchón),
> nunca se describe como riesgo de impago. El prompt del informe IA tiene esta
> misma instrucción explícita.

### 4.5 Las TRES capas de red flags (y sus categorías legibles)

El resultado del análisis lleva tres familias de alertas, cada una con origen y
momento distintos. No se mezclan:

| Capa | Qué audita | Cuándo se genera | Dónde vive en el resultado |
|------|------------|------------------|----------------------------|
| **`pdfReliabilityFlags`** | El PDF **contra sí mismo** (balance que no cuadra, utilidad sospechosa, transacciones con socios, notas contradictorias) | Al **extraer el PDF** (IA) | `result.pdfReliabilityFlags` (el servicio las copia del análisis `pdf` al realizar el estudio) |
| **`centralRiskFlags`** | Señales de la **central** independientes del PDF | Al **realizar el estudio** (motor) | `result.centralRiskFlags` |
| **`alerts`** | Las 7 dimensiones + veracidad + salvedades de fuente + eliminatorios | Al **realizar el estudio** (motor) | `result.alerts` |

Ambas familias de red flags llevan un **`category` (código estable, para
íconos/filtros del front) + `categoryLabel` (texto en español para el cliente)**:

**`centralRiskFlags`** (las produce el motor desde el snapshot de la central):

| `category` | `categoryLabel` | Cuándo se dispara |
|------------|-----------------|-------------------|
| `legal_status` | Estado legal | Matrícula cancelada o empresa en liquidación (además es eliminatorio) |
| `payment_behavior` | Comportamiento de pago | Índice de mora ≥ 0.2 (warning) / ≥ 0.5 (danger), con el peor mes |
| `indebtedness` | Endeudamiento | `saldoMora > 0` (danger) o `porcentajeDeuda` ≥ 60% (warning) / ≥ 80% (danger) |
| `suggested_amount` | Monto avalado por la central | `montoSugerido = 0` (danger) |
| `score` | Puntaje de la central | Score < 500 (banda de riesgo alto) |

**`pdfReliabilityFlags`** (las produce la IA al extraer el PDF):

| `category` | `categoryLabel` |
|------------|-----------------|
| `balance` | Balance general |
| `resultados` | Estado de resultados |
| `relacionados` | Partes relacionadas |
| `tendencia` | Tendencia |
| `notas` | Notas a los estados financieros |
| `legibilidad` | Legibilidad del documento |
| `otro` | Otro |

La categoría `legibilidad` merece mención aparte: se emite cuando el PDF cargado
**no es un documento digital sino un escaneo o fotografía** de las páginas. La IA
sí puede leer esos documentos (OCR visual), pero los dígitos leídos de una foto
son menos confiables que el texto digital, así que la flag advierte *cómo* se
leyeron las cifras (warning si el escaneo es claro, danger si hay partes borrosas
o ilegibles). Complementa la validación del endpoint `extract-pdf`, que rechaza
de entrada archivos que ni siquiera son PDF (imágenes u otros documentos
renombrados a `.pdf`, verificados por los bytes mágicos `%PDF-`).

---

## 5. Modelo de datos: `ScoringConfiguration`

Configuración de pesos **por empresa Y por tipo de persona**, **versionada**.
PN y PJ son perfiles de riesgo distintos (en PJ pesa la veracidad porque hay dos
fuentes de EEFF; en PN pesa el riesgo de central porque no hay contraste posible),
así que **cada empresa tiene UNA config vigente por tipo** (una PN + una PJ). Cada
tipo acumula N versiones en el tiempo; una vigente (`isActive=true`) por tipo.

```prisma
model ScoringConfiguration {
  id           String @id @default(uuid()) @db.Uuid
  companyId    String @map("company_id") @db.Uuid
  // Tipo de persona al que aplica (Parameter person_type: naturalPerson | legalEntity).
  personTypeId Int    @map("person_type_id")

  // Pesos por dimensión (columnas fijas). Suman 100 según el tipo: PJ usa las 7;
  // PN usa 6 (veracity=0). Cada peso activo >= MIN_WEIGHT.
  weightFinancialHealth  Int @map("weight_financial_health")
  weightPaymentCapacity  Int @map("weight_payment_capacity")
  weightTermCoherence    Int @map("weight_term_coherence")
  weightCreditLineAdequacy Int @map("weight_credit_line_adequacy")
  weightCapitalExposure  Int @map("weight_capital_exposure")
  weightVeracity         Int @map("weight_veracity")
  weightCentralRisk      Int @map("weight_central_risk")

  isActive  Boolean  @default(true) @map("is_active") // vigente (por empresa+tipo)
  createdBy String   @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  company       Company       @relation(fields: [companyId], references: [id])
  personType    Parameter     @relation("ScoringConfigurationPersonType", fields: [personTypeId], references: [id])
  createdByUser Profile       @relation(fields: [createdBy], references: [id])
  creditStudies CreditStudy[] // estudios congelados con esta config

  @@index([companyId, personTypeId, isActive])
  @@map("scoring_configurations")
}
```

Y en `CreditStudy`:

```prisma
// Config de scoring con la que se realizó el análisis. Nullable hasta que se
// realiza (se graba en ese momento → congelación por referencia).
scoringConfigurationId String? @map("scoring_configuration_id") @db.Uuid
scoringConfiguration   ScoringConfiguration? @relation(fields: [scoringConfigurationId], references: [id])
```

### 5.1 Reglas del modelo

- **Pesos:** columnas fijas (tipado fuerte, validable). Agregar una dimensión 8
  futura requeriría migración (aceptado).
- **Versionado por (empresa, tipo):** reconfigurar PN inserta una fila PN nueva
  `isActive=true` y desactiva la PN anterior; la PJ no se toca. La tabla completa
  es el historial.
- **Grabado en el estudio:** al **realizar el análisis** se copia el id de la
  config `isActive` del **tipo de persona del cliente** al `CreditStudy`. Los
  estudios viejos siguen apuntando a su config → sin recálculo retroactivo,
  auditable.
- **Validación consciente del tipo:** suma total = 100 siempre. En **PJ** las 7
  dimensiones aplican (cada peso >= `MIN_WEIGHT`=5). En **PN** la veracidad debe
  ser **0** (no hay contraste posible sin EEFF de la central) y las otras 6 suman
  100 con el mínimo. La regla la impone `validateWeights(weights, personType)`.

### 5.2 Config default al crear la empresa

Al nacer una empresa (en [`onboarding.service.ts`](../src/onboarding/onboarding.service.ts)),
se crean **DOS** `ScoringConfiguration` v1 (una PN + una PJ) con los **pesos
default del sistema** por tipo. Así toda empresa tiene config de ambos tipos desde
el día 1 sin obligar a configurar.

Defaults (`scoring.constants.ts` → `DEFAULT_WEIGHTS_PJ` / `DEFAULT_WEIGHTS_PN`):

| Dimensión | PJ | PN |
|-----------|---:|---:|
| Capacidad de pago | 20 | 26 |
| Veracidad | 20 | **0** |
| Riesgo de la central | 15 | 25 |
| Salud financiera | 15 | 19 |
| Adecuación del cupo | 12 | 12 |
| Exposición del capital | 10 | 10 |
| Coherencia de plazos | 8 | 8 |
| **Total** | **100** | **100** |

> En **PN** la veracidad es 0 (no evaluable sin EEFF de la central) y esos 20
> puntos se reparten hacia riesgo de central (+10), capacidad (+6) y salud (+4):
> lo más confiable que se tiene de una persona natural es su comportamiento en la
> central.
>
> ⚠️ **Empresas creadas antes de esta feature** no tienen las configs (no hubo
> backfill automático): se crean desde el front vía el CRUD. Hasta entonces, el
> `GET .../active` devuelve los defaults con `isDefault:true` (no persistidos).

---

## 6. Cálculo del score con pesos

### 6.1 Puntaje de cada dimensión → normalizado 0..1

Cada dimensión produce un puntaje relativo (p. ej. 20/20 = 1.0, 12/20 = 0.6,
0/20 = 0). Luego se pondera:

```
scoreDimension_i = ratio_i (0..1)
contribución_i   = scoreDimension_i × peso_i
viabilityScore   = Σ contribución_i      // 0..100 (los pesos suman 100)
```

### 6.2 Veredicto (reglas eliminatorias, umbrales y cap)

**Reglas ELIMINATORIAS** (rechazo directo, sin importar el score), en orden. Al
disparar, se registra el motivo en `summary.eliminatoryReason`:

| Condición | Veredicto | Motivo |
|-----------|-----------|--------|
| Matrícula mercantil **cancelada** o empresa **en liquidación** | `rejected` | No es sujeto de crédito (estado legal). Se lee de `bureauProfile` (`registration.status` / `generalProfile.inLiquidation`). |
| **`montoSugerido == 0`** (la central no avala ningún monto) | `rejected` | La central no lo reconoce como sujeto de crédito. `approvedCreditLine` se recorta a **0**. |
| `monthlyPaymentCapacity <= 0` | `rejected` | Sin capacidad de pago. |

**Umbrales por score** (si ninguna eliminatoria aplica):

| Condición | Veredicto |
|-----------|-----------|
| `viabilityScore >= 75` | `approved` |
| `viabilityScore >= 40` | `conditional` |
| `viabilityScore < 40` | `rejected` |

**CAP por banda de riesgo de la central** (aplica DESPUÉS de los umbrales): si la
central marca **riesgo alto** (`score < 500` o `nivelRiesgo` MÁXIMO/ALTO), el
veredicto se limita a `conditional` — **nunca `approved`**, aunque el score
supere 75. La central es la fuente de verdad sobre riesgo crediticio; un PDF
auto-reportado no puede aprobar a quien la central marca inviable. NO fuerza
rechazo (baja a `conditional`, no a `rejected`).

> ⚠️ **Importante:** `montoSugerido` distingue `null` (no hubo consulta → sin
> techo, se avala lo pedido) de `0` (la central avala **cero** → eliminatorio +
> `approvedCreditLine` recortado a 0). Antes `0` se trataba como "sin techo": bug
> corregido.

### 6.3 Dimensiones no evaluables (redistribución)

Si una dimensión no se puede calcular (p. ej. Veracidad sin PDF, o Riesgo central
sin consulta), su peso se **redistribuye proporcionalmente** entre las evaluables
para que el score siga en escala 0..100. **Decisión: redistribuir** (no puntuar
neutro).

```
evaluables   = dimensiones con datos suficientes
pesoFaltante = Σ pesos de las NO evaluables
para cada dimensión evaluable i:
   pesoEfectivo_i = peso_i + pesoFaltante × (peso_i / Σ pesos evaluables)
viabilityScore = Σ (ratio_i × pesoEfectivo_i)   // sigue 0..100
```

Ejemplo: en PN la Veracidad nunca se evalúa (peso 0 por config + sin contraste
posible). En PJ, si falta el PDF o la consulta a la central, la dimensión afectada
tampoco evalúa. En ambos casos ese peso se reparte proporcionalmente entre las
dimensiones evaluables; el score sigue en 0..100 y el veredicto usa los mismos
cortes.

---

## 7. Qué se congela en el estudio

El `viabilityConditions` (JSON) ya existente se amplía para incluir las 2
dimensiones nuevas y el bloque de referencia de la central. Además el estudio
graba `scoringConfigurationId`. Así, un estudio es **auditable**: se sabe con qué
pesos y contra qué cifras se decidió.

```json
{
  "dimensions": {
    "financialHealth": { "score": 15, "weight": 15, "status": "healthy" },
    "paymentCapacity": { "score": 20, "weight": 20, "status": "comfortable" },
    "termCoherence": { "score": 0, "weight": 8, "status": "incoherent" },
    "creditLineAdequacy": { "score": 12, "weight": 12, "status": "adequate" },
    "capitalExposure": { "score": 10, "weight": 10, "status": "efficient" },
    "veracity": { "score": 0, "weight": 20, "status": "manipulated", "worstDiff": 0.41, "field": "ordinaryActivityRevenue" },
    "centralRisk": { "score": 9, "weight": 15, "status": "medium_risk", "nivel": "MEDIO" }
  },
  "reference": {
    "experianScore": 645,
    "experianSuggestedAmount": 85000000,
    "experianRiskLevel": "MEDIO"
  },
  "alerts": [ ... ],
  "summary": {
    "totalScore": 66,
    "maxScore": 100,
    "status": "conditional",
    "scoringConfigurationId": "…",
    "calculationSource": "datacredito"
  }
}
```

---

## 8. Dónde se realiza cada parte

| Momento | Qué ocurre |
|---------|------------|
| **Crear empresa** (onboarding) | Se crea `ScoringConfiguration` v1 con pesos default. |
| **Empresa reconfigura** (CRUD nuevo) | INSERT config nueva `isActive`, desactiva anterior. |
| **Cargar PDF** (`extract-pdf`) | Red flags del **PDF** (coherencia interna) — como hoy. Se guardan las cifras de ambas fuentes. |
| **Realizar estudio** (análisis) | Corre las 7 dimensiones sobre DataCrédito; Dim 6 contrasta PDF↔DataCrédito; graba `scoringConfigurationId`; construye `viabilityConditions`. |

> Las **red flags del PDF** (internas) siguen generándose en la extracción. Las
> **red flags de veracidad** (contraste) se generan al realizar el estudio. Son
> dos capas distintas y complementarias.

---

## 9. Alcance de implementación (todo junto, como se decidió)

1. **Modelo + migración:** `ScoringConfiguration` + FK nullable en `CreditStudy`.
   Nullable, no destructiva. Aplicar staging→prod con npm scripts.
2. **Config default en onboarding:** crear v1 al nacer la empresa.
3. **CRUD de configuración:** endpoints para leer la vigente, listar historial y
   crear nueva versión (con validación suma=100 y `MIN_WEIGHT`). Backfill: crear
   v1 para empresas ya existentes.
4. **Mapper:** agregar `taxes` (Experian sí lo trae) al diccionario de EEFF.
5. **Motor de scoring v2:** 7 dimensiones ponderadas, corriendo sobre DataCrédito
   con fallback a PDF; Dim 6 contraste; Dim 7 central; redistribución de pesos no
   evaluables; veredicto.
6. **Grabar config en el estudio** al realizar el análisis.
7. **Reactivar el endpoint de análisis** (`getCreditStudyPerform`, hoy
   desactivado) adaptado al modelo nuevo y a las fuentes.
8. **Ampliar `viabilityConditions`** con dimensiones nuevas + bloque de referencia.
9. **Documentar** y verificar (`tsc`, simulación con WAYNE).

### Decisiones finales (cerradas)
- **Redistribución** proporcional para dimensiones no evaluables (§6.3). ✅
- **Dim 7 rica:** `nivel` + penalización por `ratingSectorial` alto + mora del
  vector de comportamiento (§4.2). ✅
- **`MIN_WEIGHT = 5`** por dimensión (7 × 5 = 35 piso, 65 repartibles). ✅
- **CRUD de configuración completo** en esta fase + backfill de v1 para empresas
  existentes. ✅

---

## 10. Estado

Todas las decisiones cerradas e implementadas. Ver §11.

---

## 11. Estado de implementación (lo que se construyó)

Implementado en 4 hitos. Diferencias respecto a la propuesta original marcadas con ⚠️.

### Modelo de datos y migraciones
- `ScoringConfiguration` (por empresa **y tipo de persona**, versionada, 7 columnas
  de peso, `isActive`, `personTypeId` FK a Parameter).
- `CreditStudy.scoringConfigurationId` (FK nullable, se graba al analizar).
- Migraciones aplicadas a **staging y prod**:
  - `20260712170000_scoring_configuration` (tabla + FK en credit_studies).
  - `20260712190000_scoring_config_person_type` (columna `person_type_id` + índice
    por (empresa, tipo, activa); backfill: configs previas → `legalEntity`).
- Config default creada al nacer la empresa (onboarding): **dos** filas (PN y PJ)
  con `DEFAULT_WEIGHTS_PN` / `DEFAULT_WEIGHTS_PJ`.
- ⚠️ **Sin backfill automático** para empresas existentes: sus configs se crean
  desde el front vía el CRUD (decisión del usuario).

### Config separada por tipo de persona (PN / PJ)
Cada empresa tiene una config vigente **por tipo**. `performStudy` elige la del
tipo de persona del cliente del estudio. En **PN** la Veracidad no aplica (peso 0
+ sin contraste) → se redistribuye → PN se evalúa con 6 dimensiones. PN además
**exige PDF** (Experian no reporta EEFF de PN), por lo que `createFromBureau` crea
todo estudio (PN y PJ) en estado `pendingFinancialStatements`.

### Endpoints
| Método | Ruta | Qué hace |
|--------|------|----------|
| GET | `/companies/:companyId/scoring-configurations/active?personType=` | Config vigente del tipo (o defaults con `isDefault:true` si no hay). `personType` **obligatorio**. |
| GET | `/companies/:companyId/scoring-configurations?personType=` | Historial. `personType` **opcional** (sin él, ambos tipos). |
| GET | `/companies/:companyId/scoring-configurations/:id` | Una config por id. |
| POST | `/companies/:companyId/scoring-configurations?personType=` | Crea nueva versión del tipo (valida suma=100, `MIN_WEIGHT=5`, veracity=0 en PN). |
| POST | `/companies/:companyId/credit-studies/:id/perform` | **Realiza el análisis** (corre el motor, congela config, persiste resultado, avanza a `studyCompleted`). Devuelve el mismo objeto que `step3` (§12.2). |
| GET | `/companies/:companyId/credit-studies/:id/steps` | Fuente única del wizard: cabecera + step1/2/3. El step3 trae el resultado (null hasta realizarlo) + `aiAnalysis` si ya se generó el informe. |
| POST | `/companies/:companyId/ai-analyses/credit-studies/:creditStudyId` | **Informe ejecutivo IA** del estudio ya analizado (prompt v2, consciente de PN/PJ). |

> `personType` = `naturalPerson` | `legalEntity`. Cada fila de config devuelve
> tanto `personTypeId` como el objeto `personType { id, code, label, description }`
> (legible para el front).
>
> ⚠️ **No hay endpoint de "actualizar" config.** Editar = crear versión nueva
> (`POST`), porque las configs son inmutables/versionadas (auditabilidad).

### Dim 7 — Riesgo de la central (bandas de score)
⚠️ La propuesta original basaba la Dim 7 en el `nivel` (BAJO/MEDIO/ALTO). La
implementación la basa en el **`puntajeScore`** (150-950) mapeado a bandas
estándar de DataCrédito, que es más granular. El `nivel` pasó a ser contexto.

| Puntaje | Banda | ratio base |
|---------|-------|-----------:|
| ≥ 750 | Excelente | 1.0 |
| 700–749 | Bueno | 0.8 |
| 650–699 | Aceptable | 0.6 |
| 500–649 | Regular | 0.4 |
| < 500 | Riesgo alto | 0.0 |

Penalizaciones sobre la base: −0.15 si `ratingSectorial` alto (4/5/ALTO); mora
**graduada por severidad × recencia** hasta −0.40 (ver §4.2); −0.15 si el cupo
solicitado supera el `montoSugerido` (over-ask). Resultado `clamp(0,1)`. Las
bandas son constantes en `scoring.constants.ts` (`SCORE_BANDS`), no
parametrizables por empresa (si el proveedor cambia la escala, se ajusta en un
solo lugar). Si no hay `score`, cae al `nivel` como respaldo.

### Salvedad de la fuente (para que el cliente decida)
El resultado declara con qué se calculó:
- `summary.calculationSource`: `'datacredito'` | `'pdf'` | `'none'`.
- `summary.financialsVerified`: `true` solo si corrió sobre DataCrédito **y** hubo
  PDF para contrastar.
- Alerta `warning` si corrió sobre PDF (cifras auto-reportadas, sin verificar);
  alerta `info` si corrió sobre DataCrédito sin PDF (sin contraste de veracidad).

### Monto aprobado (techo de la central, no fórmula propia)
- **No** reimplementamos las *recomendaciones de cupo/plazo* con fórmula propia
  (`paymentSuggestions` del modelo viejo sigue fuera de alcance).
- **Sí** producimos un **monto aprobado** = el cupo solicitado acotado al
  `montoSugerido` de la central (ver §4.3). Vive en `recommendedCreditLine` y en
  `approvedCreditLine` del JSON. El plazo aprobado (`recommendedTerm`) refleja el
  plazo solicitado (no lo recalculamos). Nunca aprobamos por encima del techo de
  la central, en PN y PJ por igual.
- **Caso PN sin estados financieros de ninguna fuente:** requiere un modelo de
  análisis distinto (una persona natural sin EEFF no puede evaluarse con las
  dimensiones financieras). Pendiente de diseño en documento aparte.

### Archivos
| Archivo | Rol |
|---------|-----|
| [`scoring.constants.ts`](../src/scoring/scoring.constants.ts) | Dimensiones, pesos default, `MIN_WEIGHT`, `SCORE_BANDS`, severidades de mora, labels de categorías. |
| [`scoring.validation.ts`](../src/scoring/scoring.validation.ts) | `validateWeights`, `weightsToColumns`. |
| [`scoring.engine.ts`](../src/scoring/scoring.engine.ts) | `runScoring()` — motor puro de 7 dimensiones + eliminatorios + cap + red flags de la central. |
| [`scoring.types.ts`](../src/scoring/scoring.types.ts) | Entrada/salida del motor. |
| [`scoring.service.ts`](../src/scoring/scoring.service.ts) / `.repository.ts` / `.controller.ts` | CRUD de configuración. |
| [`credit-studies.service.ts`](../src/credit-studies/credit-studies.service.ts) | `performStudy()` arma la entrada y corre el motor; `getSteps()` sirve el stepper. |
| [`ai-analyses.service.ts`](../src/ai-analyses/ai-analyses.service.ts) | `analyze()` — informe ejecutivo IA sobre el resultado. |
| [`credit-study-analysis.prompt.ts`](../src/ai/prompts/credit-study-analysis.prompt.ts) | Prompt v2 del informe IA (consciente de PN/PJ, 3 capas de flags, keyFigures). |

---

## 12. Flujo end-to-end: cómo procesa Creditia un estudio de crédito

Esta sección explica el recorrido completo, para cualquiera que llegue nuevo al
proyecto. El actor es una **empresa cliente de Creditia** que quiere decidir si
le otorga crédito comercial a un cliente suyo (el "customer").

### 12.1 Los cuatro pasos (y el estado del flujo)

```
1. POST /credit-studies/from-bureau        → consulta DataCrédito + crea el estudio
      estado: pendingFinancialStatements ("Pendiente Estados Financieros")
      (consume 1 crédito de la bolsa de la empresa)

2. POST /credit-studies/:id/financial-statements/extract-pdf
      → la IA lee el PDF de EEFF del cliente (cifras + red flags de fiabilidad)
      → si la consulta a la central trajo EEFF, se crea el análisis paralelo
        'datacredito' con los MISMOS indicadores (comparabilidad)
      estado: pendingStudyAnalysis ("Pendiente Análisis de Estudio")

3. POST /credit-studies/:id/perform        → corre el motor de scoring v2
      → 7 dimensiones ponderadas con la config de la empresa (por tipo PN/PJ)
      → reglas eliminatorias + cap por riesgo de la central
      → persiste el resultado completo (score, veredicto, monto aprobado,
        keyFigures, 3 capas de flags) y congela la config usada
      estado: studyCompleted ("Estudio Realizado")

4. POST /ai-analyses/credit-studies/:id    → informe ejecutivo narrativo (IA)
      → prompt v2: dimensiones, monto aprobado, central, flags, cifras clave
      → queda ligado al estudio; el stepper lo devuelve en step3.aiAnalysis
```

La confirmación/rechazo del estudio por el usuario (estados `confirmed` /
`rejected` / `pendingSignature` / `closed`) es un paso posterior del flujo de
negocio; una vez confirmado/cerrado, el estudio **no se puede re-analizar**.

### 12.2 El contrato de respuesta: `perform` ≡ `step3`

`POST /:id/perform` y el bloque `step3` de `GET /:id/steps` devuelven **el mismo
objeto**, construido por un único builder (`buildStep3`):

```jsonc
{
  "viabilityScore": 57,
  "viabilityStatus": "conditional",      // approved | conditional | rejected
  "recommendedCreditLine": 50000000,     // monto avalado (techo de la central)
  "recommendedTerm": 40,
  "resolutionDate": "...",
  "result": { /* ScoringResult completo, ver 12.3 */ },
  "aiAnalysis": { ... } | null           // SOLO en step3 (el informe se genera después)
}
```

`GET /:id/steps` es la fuente única del wizard del front:
- **nivel raíz**: `creditStudyId`, `status` (etapa del flujo), `studyDate`,
  `request` (cupo/plazo solicitados).
- **step1**: datos del cliente (con `isLegalEntity` y `personType` legible).
- **step2**: estados financieros por fuente (`pdf_upload` y/o `datacredito`),
  cada una con sus 2 años crudos, indicadores, ratios y (solo PDF) las
  `reliabilityFlags` — ver `financial-statements-model.md`.
- **step3**: el resultado del análisis (contrato de arriba).

### 12.3 Qué contiene el `result` (ScoringResult)

| Bloque | Qué es |
|--------|--------|
| `summary` | score 0-100, veredicto, fuente del cálculo (`datacredito`/`pdf`), `financialsVerified`, `eliminatoryReason` (si el rechazo fue por regla dura, no por score) |
| `dimensions` | las 7 dimensiones: ratio 0-1, peso efectivo, contribución, status, `evaluable` (si no lo es, su peso se redistribuyó) |
| `alerts` | mensajes por dimensión + salvedades de fuente + eliminatorios |
| `approvedCreditLine` | solicitado vs avalado, techo de la central, `cappedByBureau` |
| `keyFigures` | cifras clave YA calculadas para mostrar (no re-derivar en el front): capacidad de pago mensual/anual, cuota estimada, **cobertura de la cuota** (veces), servicio de deuda, EBITDA, rotaciones (cartera/inventarios/proveedores), **ciclo de caja**, factor de estabilidad |
| `centralRiskFlags` | red flags de la central con `category` + `categoryLabel` (§4.5) |
| `pdfReliabilityFlags` | red flags de fiabilidad del PDF con `category` + `categoryLabel` (§4.5) |
| `reference` | score/nivel/montoSugerido de Experian, tal cual |

### 12.4 Principios que gobiernan el análisis

1. **La central es la fuente de verdad del riesgo crediticio.** El PDF es
   auto-reportado: puede calcular, pero nunca sobreescribir a la central
   (cap del veredicto, techo del monto, veracidad obligatoria en PJ).
2. **Nunca se aprueba más de lo que la central avala** (`montoSugerido`), y
   `montoSugerido = 0` es rechazo directo.
3. **El resultado siempre declara su confianza**: con qué fuente se calculó y si
   las cifras están verificadas — el cliente de Creditia decide con esa salvedad
   a la vista.
4. **Todo lo mostrado sale del mismo cálculo**: el front y el informe IA
   consumen las MISMAS cifras (`keyFigures`, flags, dimensiones) que produjo el
   motor; nadie recalcula por su cuenta.
5. **El análisis se congela**: config de pesos, análisis financieros y resultado
   quedan atados al estudio al momento del `perform`; cambiar la config después
   no altera estudios ya realizados (re-ejecutar el `perform` sí recalcula).
