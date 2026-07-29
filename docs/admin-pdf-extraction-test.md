# Banco de pruebas de extracción de PDF (portal admin)

Endpoints para probar cómo la IA lee un PDF de estados financieros y qué
indicadores/ratios salen de esas cifras, **sin tocar los datos del negocio**: no
crea la fila de `ai_analyses`, no almacena el PDF, no crea períodos ni análisis
financieros, no toca ningún estudio y no consume bolsa de ningún cliente. Sirve
para afinar el prompt y validar documentos difíciles.

Lo único que se persiste es el **resultado** de cada corrida, en la tabla
`pdf_extraction_tests` (response completo en JSONB + nombre del archivo). Así se
puede volver a revisar lo que dio un documento **sin re-subir el PDF ni pagar
otra corrida de IA**.

| Método | Ruta | Qué hace |
|--------|------|----------|
| `POST` | `/api/admin/pdf-extraction-test` | Corre la extracción sobre un PDF y archiva el resultado |
| `GET` | `/api/admin/pdf-extraction-tests` | Lista las corridas archivadas (paginado, `?search` por nombre) |
| `GET` | `/api/admin/pdf-extraction-tests/:id` | Detalle de una corrida archivada |
| `DELETE` | `/api/admin/pdf-extraction-tests/:id` | Borra una corrida archivada |

Todos exigen `AdminGuard` (usuario activo en `platform_admins`).

---

## 1. Correr una prueba — `POST /api/admin/pdf-extraction-test`

### Request

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

### Response `201`

Los valores del ejemplo son **reales**: salen de correr los helpers de
`financial-indicators` sobre las cifras de los dos períodos mostrados, así que
sirven para cuadrar la vista.

`id`, `fileName` y `createdAt` identifican la corrida ya archivada: con ese `id`
se vuelve a abrir el mismo resultado por `GET .../pdf-extraction-tests/:id` sin
re-subir el PDF.

```json
{
  "id": "b3f1c9d2-4e77-4a51-9c8e-2d6f0a17be44",
  "fileName": "estados-financieros-acme-2025.pdf",
  "createdAt": "2026-07-28T20:14:02.318Z",
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

**`usage`** — consumo de la corrida. Queda archivado en la fila y es el único
registro del costo de estas pruebas (no pasan por `ai_analyses`): conviene
mostrarlo en pantalla. `promptTokens`, `completionTokens`, `totalTokens`,
`estimatedCostUsd` y `durationMs` pueden venir `null` si el proveedor no los
reporta; `model` siempre viene.

---

## 2. Listar corridas archivadas — `GET /api/admin/pdf-extraction-tests`

Fila liviana para elegir cuál abrir: **no** trae el JSON de la corrida ni el
texto crudo. Del más reciente al más antiguo.

| Query param | Tipo | Default | Descripción |
|-------------|------|---------|-------------|
| `page` | number ≥ 1 | `1` | Página |
| `limit` | number ≥ 1 | `10` | Filas por página |
| `search` | string | — | Filtra por **nombre del archivo** (contiene, sin distinguir mayúsculas) |

```
GET /api/admin/pdf-extraction-tests?search=acme&page=1&limit=10
```

```json
{
  "data": [
    {
      "id": "b3f1c9d2-4e77-4a51-9c8e-2d6f0a17be44",
      "fileName": "estados-financieros-acme-2025.pdf",
      "fileSizeBytes": 842137,
      "incomeStatementId": 1,
      "fiscalYear": null,
      "model": "gemini-2.5-pro",
      "totalTokens": 21273,
      "estimatedCostUsd": 0.051465,
      "durationMs": 34218,
      "periodsCount": 2,
      "flagsCount": 2,
      "createdAt": "2026-07-28T20:14:02.318Z",
      "performedBy": {
        "userId": "9c1e7a04-55b2-4d38-9f0a-7e1c3b6d2f81",
        "name": "Gabriel Herrera",
        "email": "gabriel@creditia.co"
      }
    },
    {
      "id": "5a80f6bb-1c2d-4e9f-8a37-b04c95e7d612",
      "fileName": "estados-financieros-acme-2025.pdf",
      "fileSizeBytes": 842137,
      "incomeStatementId": null,
      "fiscalYear": 2025,
      "model": "claude-haiku-4-5-20251001",
      "totalTokens": 19864,
      "estimatedCostUsd": 0.0182,
      "durationMs": 21507,
      "periodsCount": 2,
      "flagsCount": 4,
      "createdAt": "2026-07-27T16:03:44.902Z",
      "performedBy": {
        "userId": "9c1e7a04-55b2-4d38-9f0a-7e1c3b6d2f81",
        "name": "Gabriel Herrera",
        "email": "gabriel@creditia.co"
      }
    },
    {
      "id": "e7c40a18-93b6-4f2a-bd51-6c8e0f3a72d9",
      "fileName": "eeff-distribuidora-lopez-escaneado.pdf",
      "fileSizeBytes": 4192864,
      "incomeStatementId": 1,
      "fiscalYear": null,
      "model": "gemini-2.5-pro",
      "totalTokens": 33915,
      "estimatedCostUsd": 0.08791,
      "durationMs": 51230,
      "periodsCount": 3,
      "flagsCount": 5,
      "createdAt": "2026-07-24T14:22:10.771Z",
      "performedBy": {
        "userId": "2f5b8c31-6d04-49a7-b1e8-3c7a95d40f26",
        "name": "Laura Méndez",
        "email": "laura@creditia.co"
      }
    }
  ],
  "meta": { "total": 3, "page": 1, "limit": 10, "totalPages": 1 }
}
```

Las dos primeras filas son **el mismo PDF corrido dos veces**: se guarda una fila
por corrida, no una por nombre. Eso es lo que permite comparar cómo lee el mismo
documento antes y después de tocar el prompt o de cambiar de modelo (aquí, 4
flags con Haiku contra 2 con Gemini Pro).

`fileSizeBytes`, `incomeStatementId`, `fiscalYear`, `totalTokens`,
`estimatedCostUsd` y `durationMs` pueden ser `null`. Si el `userId` de
`performed_by` ya no existe en `platform_admins`, `performedBy` llega como
`{ "userId": "…", "name": null }` — **sin** la clave `email`.

---

## 3. Detalle de una corrida — `GET /api/admin/pdf-extraction-tests/:id`

Devuelve el response **tal cual se generó** el día de la corrida, sin re-procesar
el PDF ni volver a llamar a la IA:

```json
{
  "id": "b3f1c9d2-4e77-4a51-9c8e-2d6f0a17be44",
  "fileName": "estados-financieros-acme-2025.pdf",
  "fileSizeBytes": 842137,
  "createdAt": "2026-07-28T20:14:02.318Z",
  "performedBy": {
    "userId": "9c1e7a04-55b2-4d38-9f0a-7e1c3b6d2f81",
    "name": "Gabriel Herrera",
    "email": "gabriel@creditia.co"
  },
  "periodsCount": 2,
  "flagsCount": 2,
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
      "detail": "Las notas 7 y 12 revelan que $312.400.000 de los $742.300.000 de deudores comerciales (42%) corresponden a cuentas por cobrar a socios, sin plazo pactado ni intereses. Representan el 13% del activo total."
    },
    {
      "severity": "info",
      "category": "tendencia",
      "title": "La cartera crece mas rapido que los ingresos",
      "detail": "Los deudores comerciales pasaron de $615.700.000 a $742.300.000 (+20,6%) mientras los ingresos crecieron de $3.410.000.000 a $3.850.000.000 (+12,9%). El plazo de recaudo se alarga."
    }
  ],
  "usage": {
    "model": "gemini-2.5-pro",
    "promptTokens": 18432,
    "completionTokens": 2841,
    "totalTokens": 21273,
    "estimatedCostUsd": 0.051465,
    "durationMs": 34218
  },
  "raw": "```json\n{\n  \"periods\": [\n    {\n      \"fiscalYear\": 2025,\n      \"balanceSheetDate\": \"2025-12-31\",\n      \"cashAndEquivalents\": 185400000,\n      \"accountsReceivable\": 742300000,\n      \"inventories\": 518900000,\n      \"totalCurrentAssets\": 1446600000,\n      \"fixedAssetsProperty\": 892000000,\n      \"totalNonCurrentAssets\": 953400000,\n      \"totalAssets\": 2400000000,\n      \"shortTermFinancialLiabilities\": 310000000,\n      \"suppliers\": 465800000,\n      \"totalCurrentLiabilities\": 1012500000,\n      \"longTermFinancialLiabilities\": 420000000,\n      \"totalNonCurrentLiabilities\": 487500000,\n      \"totalLiabilities\": 1500000000,\n      \"retainedEarnings\": 612000000,\n      \"equity\": 900000000,\n      \"netIncome\": 214100000,\n      \"ordinaryActivityRevenue\": 3850000000,\n      \"costOfSales\": 2695000000,\n      \"grossProfit\": 1155000000,\n      \"administrativeExpenses\": 462000000,\n      \"sellingExpenses\": 308000000,\n      \"depreciation\": 96000000,\n      \"amortization\": 24000000,\n      \"financialExpenses\": 78500000,\n      \"taxes\": 92400000\n    },\n    {\n      \"fiscalYear\": 2024,\n      \"balanceSheetDate\": \"2024-12-31\",\n      \"cashAndEquivalents\": 142800000,\n      \"accountsReceivable\": 615700000,\n      \"inventories\": 471200000,\n      \"totalCurrentAssets\": 1229700000,\n      \"fixedAssetsProperty\": 845000000,\n      \"totalNonCurrentAssets\": 890300000,\n      \"totalAssets\": 2120000000,\n      \"shortTermFinancialLiabilities\": 275000000,\n      \"suppliers\": 398400000,\n      \"totalCurrentLiabilities\": 902000000,\n      \"longTermFinancialLiabilities\": 395000000,\n      \"totalNonCurrentLiabilities\": 448000000,\n      \"totalLiabilities\": 1350000000,\n      \"retainedEarnings\": 498000000,\n      \"equity\": 770000000,\n      \"netIncome\": 173300000,\n      \"ordinaryActivityRevenue\": 3410000000,\n      \"costOfSales\": 2421100000,\n      \"grossProfit\": 988900000,\n      \"administrativeExpenses\": 425000000,\n      \"sellingExpenses\": 281000000,\n      \"depreciation\": 88000000,\n      \"amortization\": 22000000,\n      \"financialExpenses\": 71200000,\n      \"taxes\": 74800000\n    }\n  ],\n  \"reliabilityFlags\": [\n    {\n      \"severity\": \"warning\",\n      \"category\": \"relacionados\",\n      \"title\": \"Cuentas por cobrar a vinculados por $312.400.000\",\n      \"detail\": \"Las notas 7 y 12 revelan que $312.400.000 de los $742.300.000 de deudores comerciales (42%) corresponden a cuentas por cobrar a socios, sin plazo pactado ni intereses. Representan el 13% del activo total.\"\n    },\n    {\n      \"severity\": \"info\",\n      \"category\": \"tendencia\",\n      \"title\": \"La cartera crece mas rapido que los ingresos\",\n      \"detail\": \"Los deudores comerciales pasaron de $615.700.000 a $742.300.000 (+20,6%) mientras los ingresos crecieron de $3.410.000.000 a $3.850.000.000 (+12,9%). El plazo de recaudo se alarga.\"\n    }\n  ]\n}\n```"
}
```

Diferencias contra el response del `POST`:

- `raw` viene **siempre** (el texto crudo se archiva aunque el `POST` original no
  lo haya pedido con `includeRaw`). Puede ser `null` si el proveedor no devolvió
  contenido.
- Se agregan `fileSizeBytes`, `performedBy`, `periodsCount` y `flagsCount`.
- El bloque archivado es inmutable: si el prompt cambia después, esta fila sigue
  mostrando lo que se leyó ese día. Para ver el resultado con el prompt nuevo hay
  que correr el `POST` otra vez.

---

## 4. Borrar una corrida — `DELETE /api/admin/pdf-extraction-tests/:id`

Limpieza del banco de pruebas. Borrado físico, sin papelera.

```json
{ "success": true, "id": "b3f1c9d2-4e77-4a51-9c8e-2d6f0a17be44" }
```

---

## Errores

| Código | Cuándo |
|--------|--------|
| `400` | Falta el archivo · no es `application/pdf` · los bytes no empiezan en `%PDF-` (imagen renombrada) · la IA falló o devolvió un JSON inválido · la extracción no devolvió ningún período · no se pudo determinar el año fiscal (→ reintentar mandando `fiscalYear`) · campo extra en el form. |
| `401` | Sin token o token inválido. |
| `403` | El usuario no está activo en `platform_admins`. |
| `404` | `GET`/`DELETE` de un `id` que no existe. |
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

export interface PdfExtractionTestUsage {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
}

/** Admin del portal que corrió la prueba. `email` falta si ya no existe. */
export interface PdfExtractionTestAuthor {
  userId: string;
  name: string | null;
  email?: string;
}

/** Núcleo del resultado: lo que comparten el POST y el detalle. */
export interface PdfExtractionTestResult {
  period: {
    incomeStatementId: number | null;
    label: string;
    months: number;
  };
  periods: PdfExtractionTestPeriod[];
  indicators: PdfExtractionTestIndicators;
  ratios: PdfExtractionTestRatios;
  reliabilityFlags: ReliabilityFlag[];
  usage: PdfExtractionTestUsage;
}

/** POST /admin/pdf-extraction-test */
export interface PdfExtractionTestResponse extends PdfExtractionTestResult {
  id: string;
  fileName: string;
  createdAt: string;
  /** Solo si el request mandó includeRaw=true. */
  raw?: string | null;
}

/** GET /admin/pdf-extraction-tests/:id */
export interface PdfExtractionTestDetail extends PdfExtractionTestResult {
  id: string;
  fileName: string;
  fileSizeBytes: number | null;
  createdAt: string;
  performedBy: PdfExtractionTestAuthor;
  periodsCount: number;
  flagsCount: number;
  /** Siempre presente en el detalle (se archiva aunque no se haya pedido). */
  raw: string | null;
}

/** Fila del listado: sin el JSON de la corrida ni el texto crudo. */
export interface PdfExtractionTestListItem {
  id: string;
  fileName: string;
  fileSizeBytes: number | null;
  incomeStatementId: number | null;
  fiscalYear: number | null;
  model: string;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  periodsCount: number;
  flagsCount: number;
  performedBy: PdfExtractionTestAuthor;
  createdAt: string;
}

/** GET /admin/pdf-extraction-tests */
export interface PdfExtractionTestListResponse {
  data: PdfExtractionTestListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}
```
