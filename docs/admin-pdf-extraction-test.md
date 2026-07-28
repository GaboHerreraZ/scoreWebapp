# Banco de pruebas de extracción de PDF (portal admin)

Endpoint para probar cómo la IA lee un PDF de estados financieros y qué
indicadores/ratios salen de esas cifras, **sin guardar nada**: no crea la fila de
`ai_analyses`, no almacena el PDF, no crea períodos ni análisis financieros, no
toca ningún estudio y no consume bolsa de ningún cliente. Sirve para afinar el
prompt y validar documentos difíciles.

---

## Request

```
POST /api/admin/pdf-extraction-test
Authorization: Bearer <access_token de Supabase de un usuario de platform_admins>
Content-Type: multipart/form-data
```

| Campo | Tipo | Req. | Descripción |
|-------|------|:----:|-------------|
| `file` | binario | ✅ | PDF de estados financieros. Máx. **15 MB**. Se valida el mimetype y los bytes mágicos `%PDF-`. |
| `incomeStatementId` | number | — | ID del `Parameter` de período del estado de resultados (mensual/anual). Rige la **anualización** de la capacidad de pago. Si se omite → anual (12 meses). |
| `fiscalYear` | number (2000–2100) | — | Año fiscal del período corriente. **Solo** se usa si el PDF no trae `fiscalYear` ni fecha de balance de la cual inferirlo. |
| `includeRaw` | boolean | — | `true` agrega al response el texto crudo que devolvió el modelo (para depurar el prompt). Default `false`. |

> ⚠️ La validación global es `forbidNonWhitelisted`: mandar un campo que no esté
> en esta tabla devuelve **400**.

### Angular

```ts
testPdfExtraction(file: File, opts: {
  incomeStatementId?: number;
  fiscalYear?: number;
  includeRaw?: boolean;
} = {}): Observable<PdfExtractionTestResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (opts.incomeStatementId != null) {
    formData.append('incomeStatementId', String(opts.incomeStatementId));
  }
  if (opts.fiscalYear != null) {
    formData.append('fiscalYear', String(opts.fiscalYear));
  }
  if (opts.includeRaw) {
    formData.append('includeRaw', 'true');
  }
  // NO fijar Content-Type a mano: el browser pone el boundary del multipart.
  return this.apiService.post<PdfExtractionTestResponse>(
    'admin/pdf-extraction-test',
    formData,
  );
}
```

### curl

```bash
curl -X POST "http://localhost:3000/api/admin/pdf-extraction-test" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@estados-financieros.pdf" \
  -F "incomeStatementId=1" \
  -F "includeRaw=false"
```

**Tarda lo que tarde la IA** (típico 20–60 s según el modelo y el tamaño del
documento). El front debe usar un spinner sin timeout corto.

---

## Response `201`

Los valores del ejemplo son **reales**: salen de correr los helpers de
`financial-indicators` sobre las cifras de los dos períodos mostrados, así que
sirven para cuadrar la vista.

```json
{
  "period": {
    "incomeStatementId": 1,
    "label": "12",
    "months": 12
  },
  "periods": [
    {
      "fiscalYear": 2025,
      "cashAndEquivalents": 185400000,
      "accountsReceivable": 742300000,
      "inventories": 518900000,
      "totalCurrentAssets": 1446600000,
      "fixedAssetsProperty": 892000000,
      "totalNonCurrentAssets": 953400000,
      "totalAssets": 2400000000,
      "shortTermFinancialLiabilities": 310000000,
      "suppliers": 465800000,
      "totalCurrentLiabilities": 1012500000,
      "longTermFinancialLiabilities": 420000000,
      "totalNonCurrentLiabilities": 487500000,
      "totalLiabilities": 1500000000,
      "retainedEarnings": 612000000,
      "equity": 900000000,
      "ordinaryActivityRevenue": 3850000000,
      "costOfSales": 2695000000,
      "grossProfit": 1155000000,
      "administrativeExpenses": 462000000,
      "sellingExpenses": 308000000,
      "depreciation": 96000000,
      "amortization": 24000000,
      "financialExpenses": 78500000,
      "taxes": 92400000,
      "netIncome": 214100000,
      "balanceSheetDate": "2025-12-31"
    },
    {
      "fiscalYear": 2024,
      "cashAndEquivalents": 142800000,
      "accountsReceivable": 615700000,
      "inventories": 471200000,
      "totalCurrentAssets": 1229700000,
      "fixedAssetsProperty": 845000000,
      "totalNonCurrentAssets": 890300000,
      "totalAssets": 2120000000,
      "shortTermFinancialLiabilities": 275000000,
      "suppliers": 398400000,
      "totalCurrentLiabilities": 902000000,
      "longTermFinancialLiabilities": 395000000,
      "totalNonCurrentLiabilities": 448000000,
      "totalLiabilities": 1350000000,
      "retainedEarnings": 498000000,
      "equity": 770000000,
      "ordinaryActivityRevenue": 3410000000,
      "costOfSales": 2421100000,
      "grossProfit": 988900000,
      "administrativeExpenses": 425000000,
      "sellingExpenses": 281000000,
      "depreciation": 88000000,
      "amortization": 22000000,
      "financialExpenses": 71200000,
      "taxes": 74800000,
      "netIncome": 173300000,
      "balanceSheetDate": "2024-12-31"
    }
  ],
  "indicators": {
    "stabilityFactor": 1,
    "ebitda": 505000000,
    "adjustedEbitda": 505000000,
    "currentDebtService": 388500000,
    "annualPaymentCapacity": 116500000,
    "monthlyPaymentCapacity": 9708333,
    "accountsReceivableTurnover": 64,
    "inventoryTurnover": 67,
    "suppliersTurnover": -46,
    "paymentTimeSuppliers": 46,
    "accountsPayableTurnover": 0.1264448541246013
  },
  "ratios": {
    "workingCapital": 434100000,
    "assetsVariation": 13.2,
    "liabilitiesVariation": 11.1,
    "equityVariation": 16.9,
    "salesGrowth": 12.9,
    "financialDebtToEbit": 1.9,
    "financialDebtToRevenue": 0.19,
    "financialDebtToEquity": 0.81,
    "liabilitiesToRevenue": 0.39,
    "grossMargin": 30,
    "ebitMargin": 13.1,
    "netMargin": 5.6,
    "operationalMargin": 10,
    "leverage": 1.67,
    "acidTest": 0.92,
    "currentRatio": 1.43,
    "roa": 8.9,
    "roe": 23.8
  },
  "reliabilityFlags": [
    {
      "severity": "warning",
      "category": "relacionados",
      "title": "Cuentas por cobrar a vinculados por $312.400.000",
      "detail": "Las notas 7 y 12 revelan que $312.400.000 de los $742.300.000 de deudores comerciales (42%) corresponden a cuentas por cobrar a socios sin plazo pactado ni intereses. Representan el 13% del activo total."
    },
    {
      "severity": "info",
      "category": "tendencia",
      "title": "La cartera crece más rápido que los ingresos",
      "detail": "Los deudores comerciales pasaron de $615.700.000 a $742.300.000 (+20,6%) mientras los ingresos crecieron de $3.410.000.000 a $3.850.000.000 (+12,9%)."
    }
  ],
  "usage": {
    "model": "gemini-2.5-pro",
    "promptTokens": 18432,
    "completionTokens": 2841,
    "totalTokens": 21273,
    "estimatedCostUsd": 0.051465,
    "durationMs": 34218
  }
}
```

Con `includeRaw=true` se agrega una clave más al final: `raw`, el texto literal
que devolvió el modelo (**string**, normalmente envuelto en un bloque
` ```json `). Es el mismo contenido del que salen `periods` y `reliabilityFlags`,
antes de normalizar — por eso `raw` conserva el orden y los signos originales del
modelo, mientras que `periods` ya trae los gastos en positivo y ordenados por año
descendente. Para el mismo documento del ejemplo:

```json
  "raw": "```json\n{\n  \"periods\": [\n    {\n      \"fiscalYear\": 2025,\n      \"balanceSheetDate\": \"2025-12-31\",\n      \"cashAndEquivalents\": 185400000,\n      \"accountsReceivable\": 742300000,\n      \"inventories\": 518900000,\n      \"totalCurrentAssets\": 1446600000,\n      \"fixedAssetsProperty\": 892000000,\n      \"totalNonCurrentAssets\": 953400000,\n      \"totalAssets\": 2400000000,\n      \"shortTermFinancialLiabilities\": 310000000,\n      \"suppliers\": 465800000,\n      \"totalCurrentLiabilities\": 1012500000,\n      \"longTermFinancialLiabilities\": 420000000,\n      \"totalNonCurrentLiabilities\": 487500000,\n      \"totalLiabilities\": 1500000000,\n      \"retainedEarnings\": 612000000,\n      \"equity\": 900000000,\n      \"netIncome\": 214100000,\n      \"ordinaryActivityRevenue\": 3850000000,\n      \"costOfSales\": 2695000000,\n      \"grossProfit\": 1155000000,\n      \"administrativeExpenses\": 462000000,\n      \"sellingExpenses\": 308000000,\n      \"depreciation\": 96000000,\n      \"amortization\": 24000000,\n      \"financialExpenses\": 78500000,\n      \"taxes\": 92400000\n    },\n    {\n      \"fiscalYear\": 2024,\n      \"balanceSheetDate\": \"2024-12-31\",\n      \"cashAndEquivalents\": 142800000,\n      \"accountsReceivable\": 615700000,\n      \"inventories\": 471200000,\n      \"totalCurrentAssets\": 1229700000,\n      \"fixedAssetsProperty\": 845000000,\n      \"totalNonCurrentAssets\": 890300000,\n      \"totalAssets\": 2120000000,\n      \"shortTermFinancialLiabilities\": 275000000,\n      \"suppliers\": 398400000,\n      \"totalCurrentLiabilities\": 902000000,\n      \"longTermFinancialLiabilities\": 395000000,\n      \"totalNonCurrentLiabilities\": 448000000,\n      \"totalLiabilities\": 1350000000,\n      \"retainedEarnings\": 498000000,\n      \"equity\": 770000000,\n      \"netIncome\": 173300000,\n      \"ordinaryActivityRevenue\": 3410000000,\n      \"costOfSales\": 2421100000,\n      \"grossProfit\": 988900000,\n      \"administrativeExpenses\": 425000000,\n      \"sellingExpenses\": 281000000,\n      \"depreciation\": 88000000,\n      \"amortization\": 22000000,\n      \"financialExpenses\": 71200000,\n      \"taxes\": 74800000\n    }\n  ],\n  \"reliabilityFlags\": [\n    {\n      \"severity\": \"warning\",\n      \"category\": \"relacionados\",\n      \"title\": \"Cuentas por cobrar a vinculados por $312.400.000\",\n      \"detail\": \"Las notas 7 y 12 revelan que $312.400.000 de los $742.300.000 de deudores comerciales (42%) corresponden a cuentas por cobrar a socios, sin plazo pactado ni intereses. Representan el 13% del activo total.\"\n    },\n    {\n      \"severity\": \"info\",\n      \"category\": \"tendencia\",\n      \"title\": \"La cartera crece mas rapido que los ingresos\",\n      \"detail\": \"Los deudores comerciales pasaron de $615.700.000 a $742.300.000 (+20,6%) mientras los ingresos crecieron de $3.410.000.000 a $3.850.000.000 (+12,9%). El plazo de recaudo se alarga.\"\n    }\n  ]\n}\n```"
```

Decodificado (lo que el front vería al hacer `JSON.parse` sobre el contenido del
bloque), `raw` es exactamente:

```json
{
  "periods": [
    {
      "fiscalYear": 2025,
      "balanceSheetDate": "2025-12-31",
      "cashAndEquivalents": 185400000,
      "accountsReceivable": 742300000,
      "inventories": 518900000,
      "totalCurrentAssets": 1446600000,
      "fixedAssetsProperty": 892000000,
      "totalNonCurrentAssets": 953400000,
      "totalAssets": 2400000000,
      "shortTermFinancialLiabilities": 310000000,
      "suppliers": 465800000,
      "totalCurrentLiabilities": 1012500000,
      "longTermFinancialLiabilities": 420000000,
      "totalNonCurrentLiabilities": 487500000,
      "totalLiabilities": 1500000000,
      "retainedEarnings": 612000000,
      "equity": 900000000,
      "netIncome": 214100000,
      "ordinaryActivityRevenue": 3850000000,
      "costOfSales": 2695000000,
      "grossProfit": 1155000000,
      "administrativeExpenses": 462000000,
      "sellingExpenses": 308000000,
      "depreciation": 96000000,
      "amortization": 24000000,
      "financialExpenses": 78500000,
      "taxes": 92400000
    },
    {
      "fiscalYear": 2024,
      "balanceSheetDate": "2024-12-31",
      "cashAndEquivalents": 142800000,
      "accountsReceivable": 615700000,
      "inventories": 471200000,
      "totalCurrentAssets": 1229700000,
      "fixedAssetsProperty": 845000000,
      "totalNonCurrentAssets": 890300000,
      "totalAssets": 2120000000,
      "shortTermFinancialLiabilities": 275000000,
      "suppliers": 398400000,
      "totalCurrentLiabilities": 902000000,
      "longTermFinancialLiabilities": 395000000,
      "totalNonCurrentLiabilities": 448000000,
      "totalLiabilities": 1350000000,
      "retainedEarnings": 498000000,
      "equity": 770000000,
      "netIncome": 173300000,
      "ordinaryActivityRevenue": 3410000000,
      "costOfSales": 2421100000,
      "grossProfit": 988900000,
      "administrativeExpenses": 425000000,
      "sellingExpenses": 281000000,
      "depreciation": 88000000,
      "amortization": 22000000,
      "financialExpenses": 71200000,
      "taxes": 74800000
    }
  ],
  "reliabilityFlags": [
    {
      "severity": "warning",
      "category": "relacionados",
      "title": "Cuentas por cobrar a vinculados por $312.400.000",
      "detail": "Las notas 7 y 12 revelan que $312.400.000 de los $742.300.000 de deudores comerciales (42%) corresponden a cuentas por cobrar a socios, sin plazo pactado ni intereses. Representan el 13% del activo total."
    },
    {
      "severity": "info",
      "category": "tendencia",
      "title": "La cartera crece mas rapido que los ingresos",
      "detail": "Los deudores comerciales pasaron de $615.700.000 a $742.300.000 (+20,6%) mientras los ingresos crecieron de $3.410.000.000 a $3.850.000.000 (+12,9%). El plazo de recaudo se alarga."
    }
  ]
}
```

Ojo con dos diferencias entre `raw` y el resto del response, ambas esperadas:
`raw` no trae `analysisId` ni orden garantizado por año, y si el modelo emite un
gasto en negativo (p. ej. `"sellingExpenses": -308000000`, porque el EERR lo
presenta entre paréntesis) `raw` lo conserva así mientras `periods` lo entrega en
positivo. El front debe pintar los indicadores desde `periods`/`indicators`, y
usar `raw` solo como panel de depuración.

### Bloques del response

**`period`** — período del estado de resultados aplicado al cálculo.
`months` es el divisor que anualiza la capacidad de pago (`monthlyPaymentCapacity
= annualPaymentCapacity / months`). Con `label: "12"` → anual.

**`periods`** — un objeto por cada año que la IA encontró en el documento
(pueden ser 1, 2, 3 o más), ordenados por `fiscalYear` **descendente**: el
primero es el corriente. Cifras en pesos, sin decimales de presentación.
`balanceSheetDate` es `"YYYY-MM-DD"` o `null`. Cualquiera de las 25 cifras puede
venir `null` si no está en el documento.

Los gastos (`costOfSales`, `administrativeExpenses`, `sellingExpenses`,
`depreciation`, `amortization`, `financialExpenses`, `taxes`) **siempre llegan en
positivo**: son magnitudes que las fórmulas restan. Los conceptos que sí pueden
ser negativos son `netIncome`, `retainedEarnings`, `equity` y `grossProfit`.

**`indicators`** — los 11 indicadores del núcleo, calculados sobre
`periods[0]` (corriente) y `periods[1]` (anterior, solo para promediar
rotaciones). Si solo hay un período, las rotaciones salen del único año.

| Campo | Significado |
|-------|-------------|
| `stabilityFactor` | Z-Score de Altman discretizado: `1` (Z > 3), `0.66` (Z > 1.8) o `0.33`. |
| `ebitda` | Ingresos − costo de ventas − gastos admin − gastos de venta + depreciación + amortización. |
| `adjustedEbitda` | `ebitda × stabilityFactor`. |
| `currentDebtService` | Obligaciones financieras corto plazo + gastos financieros. |
| `annualPaymentCapacity` | `adjustedEbitda − currentDebtService`. |
| `monthlyPaymentCapacity` | `annualPaymentCapacity / period.months`, redondeado. |
| `accountsReceivableTurnover` | Días de rotación de cartera (entero). |
| `inventoryTurnover` | Días de rotación de inventario (entero). |
| `paymentTimeSuppliers` | Días de pago a proveedores (entero). |
| `suppliersTurnover` | `-paymentTimeSuppliers` (convención interna del modelo). |
| `accountsPayableTurnover` | Fracción sin redondear de la que sale `paymentTimeSuppliers`. |

Todos son `number` (nunca `null`). Ojo: con cifras faltantes pueden salir valores
sin sentido (denominadores que caen a 1) — es información válida para la prueba,
no un error del endpoint.

**`ratios`** — los 18 ratios de presentación. Cada uno es `number | null`;
**`null` = "no calculable"** (base en 0 o ausente) y debe pintarse como `—`, no
como `0`. Los que son porcentaje ya vienen multiplicados por 100 y redondeados a
1 decimal: `assetsVariation`, `liabilitiesVariation`, `equityVariation`,
`salesGrowth`, `grossMargin`, `ebitMargin`, `netMargin`, `operationalMargin`,
`roa`, `roe`. Los demás son veces/pesos redondeados a 2 decimales, salvo
`workingCapital` que es un monto en pesos. Las cuatro variaciones son `null`
cuando no hay un segundo período con qué comparar.

**`reliabilityFlags`** — red flags de fiabilidad que emite la IA. Arreglo vacío
si el documento se ve sólido. Máximo 12, priorizadas por severidad.

- `severity`: `"danger"` | `"warning"` | `"info"`
- `category`: `"balance"` | `"resultados"` | `"relacionados"` | `"tendencia"` | `"notas"` | `"legibilidad"` | `"verificabilidad"` | `"otro"`
- `title`, `detail`: texto.

**`usage`** — consumo de la corrida. Como no se persiste nada, este es el **único
registro del costo**: conviene mostrarlo en pantalla. `promptTokens`,
`completionTokens`, `totalTokens`, `estimatedCostUsd` y `durationMs` pueden venir
`null` si el proveedor no los reporta; `model` siempre viene.

---

## Errores

| Código | Cuándo |
|--------|--------|
| `400` | Falta el archivo · no es `application/pdf` · los bytes no empiezan en `%PDF-` (imagen renombrada) · la IA falló o devolvió un JSON inválido · la extracción no devolvió ningún período · no se pudo determinar el año fiscal (→ reintentar mandando `fiscalYear`) · campo extra en el form. |
| `401` | Sin token o token inválido. |
| `403` | El usuario no está activo en `platform_admins`. |
| `413` | El PDF supera 15 MB. |

Formato estándar de Nest:

```json
{ "statusCode": 400, "message": "La extraccion del PDF fallo: Unexpected token < in JSON at position 0", "error": "Bad Request" }
```

---

## Tipos TypeScript

```ts
export interface PdfExtractionTestPeriod {
  fiscalYear: number;
  balanceSheetDate: string | null;

  cashAndEquivalents: number | null;
  accountsReceivable: number | null;
  inventories: number | null;
  totalCurrentAssets: number | null;
  fixedAssetsProperty: number | null;
  totalNonCurrentAssets: number | null;
  totalAssets: number | null;
  shortTermFinancialLiabilities: number | null;
  suppliers: number | null;
  totalCurrentLiabilities: number | null;
  longTermFinancialLiabilities: number | null;
  totalNonCurrentLiabilities: number | null;
  totalLiabilities: number | null;
  retainedEarnings: number | null;
  equity: number | null;

  ordinaryActivityRevenue: number | null;
  costOfSales: number | null;
  grossProfit: number | null;
  administrativeExpenses: number | null;
  sellingExpenses: number | null;
  depreciation: number | null;
  amortization: number | null;
  financialExpenses: number | null;
  taxes: number | null;
  netIncome: number | null;
}

export interface PdfExtractionTestIndicators {
  stabilityFactor: number;
  ebitda: number;
  adjustedEbitda: number;
  currentDebtService: number;
  annualPaymentCapacity: number;
  monthlyPaymentCapacity: number;
  accountsReceivableTurnover: number;
  inventoryTurnover: number;
  suppliersTurnover: number;
  paymentTimeSuppliers: number;
  accountsPayableTurnover: number;
}

/** Todos `number | null`; null = no calculable. */
export interface PdfExtractionTestRatios {
  workingCapital: number | null;
  assetsVariation: number | null;
  liabilitiesVariation: number | null;
  equityVariation: number | null;
  salesGrowth: number | null;
  financialDebtToEbit: number | null;
  financialDebtToRevenue: number | null;
  financialDebtToEquity: number | null;
  liabilitiesToRevenue: number | null;
  grossMargin: number | null;
  ebitMargin: number | null;
  netMargin: number | null;
  operationalMargin: number | null;
  leverage: number | null;
  acidTest: number | null;
  currentRatio: number | null;
  roa: number | null;
  roe: number | null;
}

export interface ReliabilityFlag {
  severity: 'danger' | 'warning' | 'info';
  category:
    | 'balance'
    | 'resultados'
    | 'relacionados'
    | 'tendencia'
    | 'notas'
    | 'legibilidad'
    | 'verificabilidad'
    | 'otro';
  title: string;
  detail: string;
}

export interface PdfExtractionTestResponse {
  period: {
    incomeStatementId: number | null;
    label: string;
    months: number;
  };
  periods: PdfExtractionTestPeriod[];
  indicators: PdfExtractionTestIndicators;
  ratios: PdfExtractionTestRatios;
  reliabilityFlags: ReliabilityFlag[];
  usage: {
    model: string;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    durationMs: number | null;
  };
  /** Solo si el request mandó includeRaw=true. */
  raw?: string | null;
}
```
