# Estados Financieros: modelo, fuentes y cálculos

> Documento de referencia de **todo** lo que el sistema hace con los estados
> financieros (EEFF), tanto los que sube el usuario en **PDF** como los que trae
> **DataCrédito Experian (MiDecisor)**. Cubre el modelo de datos, el flujo de
> extracción, el cálculo de indicadores/ratios y cómo se sirven al front en el
> stepper del estudio de crédito.

---

## 1. Panorama general

Un **estudio de crédito** necesita analizar la salud financiera del cliente. Esa
salud se lee de sus **estados financieros**, que pueden llegar por dos caminos:

| Fuente | `source` | Origen | Cómo se estructuran |
|--------|----------|--------|---------------------|
| **PDF** | `pdf_upload` | El usuario sube el PDF de los EEFF; la IA (Gemini/Anthropic) lo extrae | Texto libre → la IA devuelve un objeto por año |
| **DataCrédito** | `datacredito` | Vienen dentro de la respuesta de la consulta a MiDecisor (bloque `estadosFinancieros`) | Ya estructurados: matriz cuenta × año |

**Idea central:** ambas fuentes terminan en el **mismo modelo de dominio** (las
mismas ~25 columnas crudas por año) y pasan por el **mismo motor de cálculo**.
Esto hace que las cifras de PDF y las de DataCrédito sean **directamente
comparables** en pantalla (mismas fórmulas, mismas unidades). El front las
muestra lado a lado (p. ej. para PJ: 2 columnas del PDF + 2 de DataCrédito).

---

## 2. Modelo de datos

Tres tablas, con una separación deliberada entre **el hecho** (cifras de un año),
**el cálculo** (indicadores de un par de años) y **la congelación** (qué usó cada
estudio).

### 2.1 `FinancialStatementPeriod` — el hecho: cifras crudas de UN año

Una fila = el balance + estado de resultados de **un año fiscal**, de **una
fuente**. Pertenece al **cliente** (no al estudio). Un cliente acumula varias:
las que sube por PDF y las que llegan de DataCrédito. Solo guarda cifras
**crudas** — ningún indicador (esos dependen de dos años y viven aparte).

Campos clave:

- `source` — `'pdf_upload'` | `'datacredito'`
- `fiscalYear` — año fiscal (2024, 2023…)
- `analysisId` — a qué `FinancialAnalysis` pertenece (N períodos cuelgan de un análisis)
- `consultationId` — si vino de DataCrédito, a qué consulta al bureau se ata (trazabilidad)
- `balanceSheetDate`, `incomeStatementId` — fecha de corte y período del EERR

**Cifras crudas (~25 columnas):**

*Balance General:* `cashAndEquivalents`, `accountsReceivable`, `inventories`,
`totalCurrentAssets`, `fixedAssetsProperty`, `totalNonCurrentAssets`,
`totalAssets`, `shortTermFinancialLiabilities`, `suppliers`,
`totalCurrentLiabilities`, `longTermFinancialLiabilities`,
`totalNonCurrentLiabilities`, `totalLiabilities`, `retainedEarnings`, `equity`.

*Estado de Resultados:* `ordinaryActivityRevenue`, `costOfSales`, `grossProfit`,
`administrativeExpenses`, `sellingExpenses`, `depreciation`, `amortization`,
`financialExpenses`, `taxes`, `netIncome`.

### 2.2 `FinancialAnalysis` — el cálculo: indicadores de un PAR de años

Los indicadores (EBITDA, factor de estabilidad, rotaciones, capacidad de pago…)
**no** dependen de un año sino de **dos**: el año **corriente** (EERR + saldos de
cierre) y el **anterior** (saldos de apertura para promediar rotaciones). Por eso
viven aquí y no en el período.

- Los N períodos cuelgan del análisis vía `FinancialStatementPeriod.analysisId`.
- El **corriente / anterior** para los cálculos **NO** se marca con un campo: se
  resuelve por **`fiscalYear DESC`** (los 2 más recientes).
- `source` — de qué fuente salió el conjunto (redundante con los períodos, pero
  práctico para filtrar).
- **11 columnas de indicadores del núcleo** (ver §4.1).
- `ratios Json?` — **16 ratios de presentación** (ver §4.2). JSONB porque es un
  bloque de display evolutivo, no filtrable.
- `reliabilityFlags Json?` — red flags que la IA detectó al leer el PDF. Solo
  aplica a `pdf_upload`; para `datacredito` va null.

### 2.3 `CreditStudyFinancialAnalysis` — la congelación (N:M)

Join explícita entre `CreditStudy` y `FinancialAnalysis`. Al hacer el estudio se
listan aquí los análisis que se consideraron y **queda congelado**: aunque
después lleguen EEFF nuevos al cliente, el estudio viejo sigue apuntando a los
que usó. Es la trazabilidad de "estas fueron las cifras con las que decidí".

```
CreditStudy ──< CreditStudyFinancialAnalysis >── FinancialAnalysis ──< FinancialStatementPeriod
                                                        │                        │
                                                   (indicadores + ratios)   (cifras crudas 1 año)
```

---

## 3. Flujo de extracción

Ambas fuentes se procesan en **un solo endpoint**: subir el PDF dispara el
análisis de las dos.

```
POST /companies/:companyId/credit-studies/:creditStudyId/financial-statements/extract-pdf
```

Pasos de `extractPdfForStudy` ([financial-statements.service.ts](../src/financial-statements/financial-statements.service.ts)):

1. **Validar** que el estudio existe y pertenece a la empresa.
2. **IA lee el PDF** una vez → devuelve `{ periods: [...], reliabilityFlags: [] }`
   (un objeto por año, todos los campos sin sufijo). El log de la corrida
   (tokens, costo, PDF) queda en `AiAnalysis`.
3. Resolver el **período del EERR** (mensual/anual) para anualizar.
4. Construir un `FinancialStatementPeriod` por cada año, **ordenados `fiscalYear DESC`**.
5. **Calcular indicadores** con los 2 períodos más recientes.
6. **Persistir** el análisis `source='pdf_upload'` + sus N períodos + la join
   (todo en una transacción).
7. **DataCrédito (si hay):** buscar la **última consulta** del cliente que traiga
   `estadosFinancieros`; si existe, mapear sus **2 años más recientes**, calcular
   los mismos indicadores/ratios y persistir un segundo análisis
   `source='datacredito'`, congelado en el mismo estudio.
   **Si no hay EEFF de DataCrédito → se sigue solo con el PDF (no falla).**

Retorna `{ pdf, datacredito }` (el segundo puede ser `null`).

### 3.1 Mapeo del PDF (vía IA)

El PDF es texto libre. El prompt `FINANCIAL_PDF_EXTRACTION_PROMPT` instruye a la
IA a devolver un arreglo `periods`, un objeto por año, con las cifras crudas ya
en las claves del dominio. La IA **no calcula** indicadores: solo transcribe
cifras. Los indicadores los calculamos nosotros (§4).

### 3.2 Mapeo de DataCrédito (sin IA)

El bloque `estadosFinancieros` de MiDecisor **ya viene estructurado**, así que
**no necesita IA**: se mapea de forma determinista en
[experian.financials.mapper.ts](../src/credit-bureau/experian/experian.financials.mapper.ts).

Forma cruda de Experian — una **matriz cuenta × año**:

```json
"estadosFinancieros": {
  "detalle": [
    {
      "nombre": "Activos",
      "anio": [2022, 2023, 2024],
      "datos": [
        { "nombre": "Efectivo", "valores": [24853442, 35686994, 32571488] },
        { "nombre": "Total activo", "valores": [843551488, 847239172, 851584255] }
      ]
    },
    { "nombre": "Pasivos", "anio": [...], "datos": [...] },
    { "nombre": "Patrimonio", "anio": [...], "datos": [...] },
    { "nombre": "Estado de Resultados", "anio": [...], "datos": [...] },
    { "nombre": "Indicadores", "anio": [...], "datos": [...] }
  ]
}
```

El mapper hace tres cosas:

1. **Filtra** las categorías que aportan cifras crudas: `Activos`, `Pasivos`,
   `Patrimonio`, `Estado de Resultados`. **Ignora la categoría `Indicadores`** de
   Experian (sus ratios los recalculamos nosotros — ver §5).
2. **Traduce** cada nombre de cuenta de Experian a la columna del dominio, con un
   diccionario y normalización (minúsculas, sin tildes). Ej.:

   | Cuenta Experian | Columna dominio |
   |-----------------|-----------------|
   | Efectivo | `cashAndEquivalents` |
   | Cuentas comerciales por cobrar | `accountsReceivable` |
   | Total activo | `totalAssets` |
   | Cuentas comerciales por pagar | `suppliers` |
   | Total patrimonio | `equity` |
   | Ingresos operacionales | `ordinaryActivityRevenue` |
   | Utilidad neta | `netIncome` |
   | … | … |

   Las cuentas que Experian no desglosa (p. ej. depreciación/amortización dentro
   de gastos) quedan sin mapear → esa columna va `null`.
3. **Pivotea** la matriz a un objeto de cifras por año (`valores[i] ↔ anio[i]`),
   ordena `fiscalYear DESC` y **recorta a los 2 años más recientes**.

> **Capa anticorrupción (ACL):** este mapper es la única frontera acoplada a la
> forma de Experian. El `rawResponse` de la consulta se conserva **puro** en
> `CreditBureauConsultation`; nunca se contamina con nuestras traducciones.

#### Robustez contra las inconsistencias reales de MiDecisor

Las respuestas reales del proveedor NO siempre tienen la forma canónica de
arriba. El mapper tolera tres variantes descubiertas en pruebas:

1. **Envoltura `detalle.data`**: además de `detalle: [...]` (array directo),
   la central a veces envía `detalle: { data: [...], msjExcepcion, conInformacion }`.
   `extractGroups()` desenvuelve ambas formas. El primer elemento de `.data`
   suele ser `{nombre: 'fuentes', fuente: [...]}` (sin cifras) — se descarta
   solo porque no matchea las categorías.
2. **Colecciones serializadas como objeto** (herencia SOAP→JSON): una colección
   de un solo elemento puede llegar como objeto suelto, y una vacía como `{}`.
   `asArray()` normaliza todo a array (`{}` → `[]`, objeto → `[objeto]`) en los
   cuatro puntos de iteración (`detalle`, `anio`, `datos`, `valores`). Sin esto,
   un `for...of` sobre un objeto revienta con "object is not iterable".
3. **Estructura con TODOS los valores en cero**: la central puede devolver la
   plantilla completa de EEFF con cada `valores: [0,0,0]` (p. ej. empresa que no
   reportó; típico del ambiente de testing). `hasRealFigures()` descarta los
   períodos **sin ninguna cifra ≠ 0**: la estructura vacía no es información
   financiera — usarla contaminaría los indicadores y haría que la Veracidad
   marcara un falso "maquillaje del 100%". OJO: basta **una** cifra real para
   que el período se use — ceros parciales normales (inventarios 0, sin deuda
   de largo plazo…) NO descartan el período.

Si tras estos filtros no queda ningún período, se trata como "la central no
tiene EEFF" → el análisis corre sobre el PDF (con su salvedad) y en PJ la
Veracidad puntúa 0 (`unverifiable`, ver scoring v2 §4.1).

---

## 4. Cálculo de indicadores

Todo lo calcula **una sola función pura**,
`computeFinancialIndicators(figures, periodLabel)`
([financial-indicators.ts](../src/financial-statements/utils/financial-indicators.ts)),
aplicada **igual** a PDF y DataCrédito. Recibe el par de años (corriente +
anterior) y el período del EERR (para anualizar). Devuelve dos bloques: **núcleo**
(11) y **ratios** (16).

`periodLabel` (`getMonthsFromPeriod`): un número 1–12 = meses del EERR; cualquier
otra cosa cae a **12** (anual). Rige la anualización de la capacidad de pago.

### 4.1 Núcleo (11) — alimentan la viabilidad

Van a **columnas** de `FinancialAnalysis`. Son la base del estudio de crédito.

| Indicador | Fórmula |
|-----------|---------|
| `stabilityFactor` | Z-Score de Altman → escalón: `z>3 → 1`; `z>1.8 → 0.66`; resto `→ 0.33` |
| `ebitda` | Ingresos − costo ventas − admin − ventas + depreciación + amortización |
| `adjustedEbitda` | `ebitda × stabilityFactor` |
| `currentDebtService` | Oblig. financieras corto plazo + gastos financieros |
| `annualPaymentCapacity` | `adjustedEbitda − currentDebtService` |
| `monthlyPaymentCapacity` | `annualPaymentCapacity / meses del período` |
| `accountsReceivableTurnover` | `(cartera_corr + cartera_ant) / 2 / ingresos × 365` **(días)** |
| `inventoryTurnover` | `(inv_corr + inv_ant) / 2 / costo ventas × 365` **(días)** |
| `accountsPayableTurnover` | proveedores promedio / (costo ventas + Δinv + gastos) |
| `paymentTimeSuppliers` | `accountsPayableTurnover × 365` **(días)** |
| `suppliersTurnover` | `− paymentTimeSuppliers` |

**Z-Score de Altman** (`z = 1.2·x1 + 1.4·x2 + 3.3·x3 + 0.6·x4 + x5`):
- `x1` = (ActCte − PasCte) / Activo total
- `x2` = Utilidad retenida / Activo total
- `x3` = Utilidad operacional / Activo total
- `x4` = Patrimonio / Pasivo total
- `x5` = Ingresos / Activo total

### 4.2 Ratios de presentación (16) — lectura del analista

Van al **JSONB `ratios`**. **No** alimentan la viabilidad: son para que el
analista lea la salud financiera en el step2. Se calculan igual para ambas
fuentes → columnas comparables. Cada ratio devuelve `null` si su denominador es
0/ausente (no se fuerza a 0: `null` = "no calculable").

| Ratio | Fórmula |
|-------|---------|
| `workingCapital` | ActCte − PasCte |
| `assetsVariation` | Δ% Activo total vs año anterior |
| `liabilitiesVariation` | Δ% Pasivo total vs año anterior |
| `equityVariation` | Δ% Patrimonio vs año anterior |
| `salesGrowth` | Δ% Ingresos vs año anterior |
| `financialDebtToEbit` | Deuda financiera / EBIT |
| `financialDebtToRevenue` | Deuda financiera / Ingresos |
| `financialDebtToEquity` | Deuda financiera / Patrimonio |
| `liabilitiesToRevenue` | Pasivo total / Ingresos |
| `grossMargin` | Utilidad bruta / Ingresos (%) |
| `ebitMargin` | EBITDA / Ingresos (%) |
| `netMargin` | Utilidad neta / Ingresos (%) |
| `operationalMargin` | Utilidad operacional / Ingresos (%) |
| `leverage` | **Pasivo total / Patrimonio** (convención de mercado) |
| `acidTest` | (ActCte − inventarios) / PasCte |
| `currentRatio` | ActCte / PasCte |
| `roa` | Utilidad neta / Activo total (%) |
| `roe` | Utilidad neta / Patrimonio (%) |

Definiciones:
- **Deuda financiera** = oblig. financieras corto + largo plazo.
- **Utilidad operacional (EBIT)** = utilidad bruta − admin − ventas.
- **Variación** = `(actual − anterior) / |anterior| × 100`; `null` si no hay año anterior.

---

## 5. Nosotros vs. Experian: por qué recalculamos

El bloque `estadosFinancieros` de Experian **ya trae** su propia sección
`Indicadores` (ROA, ROE, márgenes, rotaciones, apalancamiento…). Aun así, **la
ignoramos y recalculamos todo nosotros**. Razones:

1. **Comparabilidad.** Si la columna PDF usa nuestra fórmula y la columna
   DataCrédito usa la de Experian, no serían comparables. Recalculando ambas con
   el mismo motor, las 4 columnas hablan el mismo idioma.
2. **Unidades.** Nuestras rotaciones van en **días** (×365); Experian las da en
   **veces/año**. Mezclar engañaría al analista.
3. **El núcleo Experian no lo da.** EBITDA, factor de estabilidad y capacidad de
   pago —lo que de verdad alimenta la viabilidad— **no** están en la respuesta de
   Experian. Hay que calcularlos sí o sí.

Todos los ratios de Experian son **estándar** (contabilidad/finanzas clásicas) y
se derivan de las cifras crudas que ya guardamos, así que reproducirlos no
depende de nada propietario suyo.

### Diferencias de definición conocidas (no son errores)

Validado contra el JSON de ejemplo (WAYNE ENTERPRISES, 2024):

| Ratio | Nuestra fórmula | Experian | Decisión |
|-------|-----------------|----------|----------|
| **Apalancamiento** | Pasivo/Patrimonio = 0.70 | Pasivo/Patrimonio = 0.7 | ✅ **Alineado** con Experian (convención de mercado en Colombia) |
| **Capital de trabajo** | ActCte−PasCte = 111M | 6.9M (fórmula no reproducible) | ✅ **Nuestra** (definición de libro, explicable) |
| **Margen operacional** | 11.7% | 13.0% (incluye otros ing./gastos) | Nuestra (diferencia menor) |
| Crecimiento ventas | 6.9% | 6.9 | Coinciden |
| Razón corriente | 2.01 | 2.0 | Coinciden |
| ROA / ROE | 0.2 / 0.4 | 0.0 / 0.2 | Coinciden (≈) |

> Los indicadores de Experian que **no** promovemos siguen disponibles en el
> `rawResponse` de la consulta, por si algún día se necesitan.

---

## 6. Cómo se sirven al front (stepper)

El estudio de crédito se arma en un **wizard de pasos**, servido por:

```
GET /companies/:companyId/credit-studies/:id/steps
```

- **step1** — datos del cliente (identidad + perfil de bureau).
- **step2** — **estados financieros** (esto).
- **step3** — estudio de viabilidad (aún null hasta hacer el análisis).

### Estructura del step2

`buildFinancialStep` ([credit-studies.service.ts](../src/credit-studies/credit-studies.service.ts))
lee los análisis **congelados** en el estudio y arma una lista `sources`, una por
fuente, cada una con sus 2 años más recientes:

```json
"step2": {
  "sources": [
    {
      "source": "pdf_upload",
      "analysisId": "...",
      "periods": [ { "fiscalYear": 2025, "...cifras crudas": 0 }, { "fiscalYear": 2024, "...": 0 } ],
      "indicators": { "ebitda": 0, "stabilityFactor": 0, "monthlyPaymentCapacity": 0, "...": 0 },
      "ratios": { "roa": 0, "roe": 0, "currentRatio": 0, "leverage": 0, "...": 0 },
      "reliabilityFlags": []
    },
    {
      "source": "datacredito",
      "analysisId": "...",
      "periods": [ { "fiscalYear": 2024, "...": 0 }, { "fiscalYear": 2023, "...": 0 } ],
      "indicators": { "...": 0 },
      "ratios": { "...": 0 },
      "reliabilityFlags": null
    }
  ]
}
```

- `step2 = null` si el estudio aún no tiene ningún análisis (paso no iniciado).
- El front pinta **una columna por período** de cada fuente. Para PJ típicamente:
  2 columnas PDF + 2 columnas DataCrédito = **4 columnas** comparables.
- `reliabilityFlags` solo trae contenido en `pdf_upload`.

---

## 7. Ejemplo end-to-end (DataCrédito, WAYNE ENTERPRISES)

Recorrido completo con el JSON real de MiDecisor para la PJ de ejemplo
(WAYNE ENTERPRISES S.A.S., NIT 999999998). Los números son los que produce
efectivamente el motor de cálculo — no ilustrativos.

### 7.1 Entrada — bloque `estadosFinancieros` (crudo de Experian)

Experian trae **3 años** (2022, 2023, 2024) como matriz cuenta × año. Extracto:

```json
{
  "nombre": "Activos", "anio": [2022, 2023, 2024],
  "datos": [
    { "nombre": "Efectivo", "valores": [24853442, 35686994, 32571488] },
    { "nombre": "Total activo", "valores": [843551488, 847239172, 851584255] }
  ]
}
```

### 7.2 Mapeo + pivoteo → períodos de dominio (2 años más recientes)

El mapper traduce nombres, pivotea y **recorta a 2 años** (2024 y 2023,
`fiscalYear DESC`). El año 2022 se descarta (fuera de la ventana de 2). Resultado
(cifras clave):

| Cifra (columna) | 2024 (corriente) | 2023 (anterior) |
|-----------------|-----------------:|----------------:|
| `totalCurrentAssets` | 221 266 753 | 228 493 457 |
| `totalAssets` | 851 584 255 | 847 239 172 |
| `suppliers` | 63 542 168 | 52 634 427 |
| `totalCurrentLiabilities` | 109 961 268 | 108 134 770 |
| `totalLiabilities` | 349 135 866 | 347 058 192 |
| `retainedEarnings` | −151 921 999 | −153 843 369 |
| `equity` | 502 448 389 | 500 180 980 |
| `ordinaryActivityRevenue` | 355 545 622 | 332 523 500 |
| `grossProfit` | 355 545 622 | 332 523 500 |
| `administrativeExpenses` | 237 402 508 | 235 084 598 |
| `sellingExpenses` | 76 567 687 | 68 535 347 |
| `netIncome` | 1 921 370 | −18 877 930 |
| `costOfSales` | 0 | 0 |
| `inventories` | 0 | 0 |

> `costOfSales` e `inventories` en 0 son datos reales de esta empresa (servicios),
> no faltantes. Por eso el margen bruto sale 100% y la rotación de inventario
> `null` (no calculable sin costo de ventas).

### 7.3 Indicadores del núcleo (calculados sobre el par 2024 + 2023)

| Indicador | Valor | Nota |
|-----------|------:|------|
| `stabilityFactor` | **0.33** | Z-Score < 1.8 → escalón bajo |
| `ebitda` | **41 575 427** | Ingresos − admin − ventas (costo=0) |
| `adjustedEbitda` | **13 719 891** | `ebitda × 0.33` |
| `currentDebtService` | **0** | Sin oblig. financieras ni gastos financieros |
| `annualPaymentCapacity` | **13 719 891** | `adjustedEbitda − 0` |
| `monthlyPaymentCapacity` | **1 143 324** | `/ 12` (período anual) |
| `accountsReceivableTurnover` | **67** | días |
| `inventoryTurnover` | **null** | costo de ventas = 0 → no calculable |
| `paymentTimeSuppliers` | **68** | días |
| `suppliersTurnover` | **−68** | `− paymentTimeSuppliers` |

### 7.4 Ratios de presentación

| Ratio | Valor | Verificación vs Experian |
|-------|------:|--------------------------|
| `workingCapital` | 111 305 485 | (nuestra def.; Experian reporta otra) |
| `salesGrowth` | 6.9 | ✅ 6.9 |
| `currentRatio` | 2.01 | ✅ 2.0 |
| `acidTest` | 2.01 | ✅ 2.0 (inventarios=0) |
| `leverage` | 0.69 | ✅ 0.7 (Pasivo/Patrimonio) |
| `grossMargin` | 100 | ✅ 100.0 |
| `operationalMargin` | 11.7 | Experian 13.0 (incluye otros ing./gastos) |
| `ebitMargin` | 11.7 | — |
| `netMargin` | 0.5 | — |
| `roa` | 0.2 | ✅ 0.0 (≈) |
| `roe` | 0.4 | ✅ 0.2 (≈) |
| `assetsVariation` | 0.5 | Δ% activo total 2024 vs 2023 |
| `liabilitiesVariation` | 0.6 | Δ% pasivo total |
| `equityVariation` | 0.5 | Δ% patrimonio |
| `financialDebtToEbit` | 0 | sin deuda financiera |
| `financialDebtToRevenue` | 0 | — |
| `financialDebtToEquity` | 0 | — |
| `liabilitiesToRevenue` | 0.98 | — |

### 7.5 Cómo llega al front

Este análisis se persiste como `FinancialAnalysis` con `source='datacredito'`,
congelado en el estudio. En el `GET /:id/steps`, aparece como una de las
`step2.sources`:

```json
{
  "source": "datacredito",
  "analysisId": "…",
  "periods": [ { "fiscalYear": 2024, … }, { "fiscalYear": 2023, … } ],
  "indicators": { "ebitda": 41575427, "monthlyPaymentCapacity": 1143324, … },
  "ratios": { "currentRatio": 2.01, "leverage": 0.69, "roe": 0.4, … },
  "reliabilityFlags": null
}
```

Si además el usuario subió un PDF, habría una segunda entrada
`source='pdf_upload'` con sus 2 años → el front pinta las **4 columnas**
comparables (2 PDF + 2 DataCrédito).

---

## 8. Decisiones de diseño (resumen)

- **Una fila por año, por fuente** — modelo append-only; el histórico no se pisa.
- **Indicadores de un par de años, no de uno** — por eso `FinancialAnalysis`
  separa el cálculo del hecho.
- **Corriente/anterior por `fiscalYear DESC`** — sin campo ni flag que los marque.
- **Núcleo en columnas, ratios en JSONB** — el núcleo se consulta/filtra (alimenta
  viabilidad); los ratios son display evolutivo.
- **Recalcular todo, ignorar los indicadores de Experian** — comparabilidad y
  unidades consistentes; el núcleo Experian no lo da.
- **PDF dispara ambas fuentes** — un solo endpoint deja las 4 columnas listas.
- **DataCrédito ausente ⇒ no falla** — se sigue solo con el PDF.
- **`rawResponse` puro** — la traducción vive solo en el mapper (ACL).

---

## 9. Archivos relevantes

| Archivo | Rol |
|---------|-----|
| [`financial-indicators.ts`](../src/financial-statements/utils/financial-indicators.ts) | Motor de cálculo (núcleo + ratios). Función pura. |
| [`experian.financials.mapper.ts`](../src/credit-bureau/experian/experian.financials.mapper.ts) | Mapea `estadosFinancieros` de MiDecisor → cifras de dominio. |
| [`financial-statements.service.ts`](../src/financial-statements/financial-statements.service.ts) | Orquesta extracción PDF + DataCrédito, persiste análisis. |
| [`financial-statements.repository.ts`](../src/financial-statements/financial-statements.repository.ts) | Persistencia de análisis/períodos; última consulta cruda. |
| [`credit-studies.service.ts`](../src/credit-studies/credit-studies.service.ts) | Arma el step2 del stepper. |
| [`schema.prisma`](../prisma/schema.prisma) | Modelos `FinancialStatementPeriod`, `FinancialAnalysis`, join. |
