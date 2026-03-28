# Integración con Claude API (Anthropic) - Backend

## Modelo: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)

---

## 1. Obtener API Key de Anthropic

1. Ir a [console.anthropic.com](https://console.anthropic.com)
2. Crear una cuenta o iniciar sesión
3. Ir a **Settings > API Keys**
4. Click en **Create Key**
5. Copiar la key (empieza con `sk-ant-...`)
6. Agregar créditos en **Settings > Billing** (mínimo $5 USD para empezar)

Guardar la key como variable de entorno en el backend:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxx
```

---

## 2. Instalar SDK

```bash
npm install @anthropic-ai/sdk
```

---

## 3. Endpoint 1: Extracción de datos desde PDF de estados financieros

### Descripción

Recibe un PDF de estados financieros, lo envía a Claude para extraer los datos y retorna un JSON estructurado con los campos del formulario de estudio de crédito.

### Implementación

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function extractFinancialData(pdfBuffer: Buffer): Promise<FinancialData> {
  const pdfBase64 = pdfBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  const textContent = response.content.find((block) => block.type === 'text');
  const json = JSON.parse(textContent?.text || '{}');
  return json;
}
```

### Prompt de extracción

```typescript
const EXTRACTION_PROMPT = `Eres un experto en contabilidad colombiana. Analiza este PDF de estados financieros y extrae los datos en el siguiente formato JSON.

REGLAS:
- Todos los valores monetarios deben ser numeros sin formato (sin puntos, sin comas, sin signo $)
- Si un campo no se encuentra en el documento, usa null
- Los campos con sufijo "1" corresponden al año mas reciente y "2" al año anterior
- Busca las cifras en el balance general, estado de resultados y notas
- Si hay valores negativos, representalos con signo negativo
- Responde UNICAMENTE con el JSON, sin texto adicional ni markdown

{
  "balanceSheetDate": "YYYY-MM-DD",

  "cashAndEquivalents": null,
  "accountsReceivable1": null,
  "accountsReceivable2": null,
  "inventories1": null,
  "inventories2": null,
  "totalCurrentAssets": null,

  "fixedAssetsProperty": null,
  "totalNonCurrentAssets": null,

  "shortTermFinancialLiabilities": null,
  "suppliers1": null,
  "suppliers2": null,
  "totalCurrentLiabilities": null,

  "longTermFinancialLiabilities": null,
  "totalNonCurrentLiabilities": null,

  "retainedEarnings": null,
  "netIncome": null,

  "ordinaryActivityRevenue": null,
  "costOfSales": null,
  "administrativeExpenses": null,
  "sellingExpenses": null,
  "depreciation": null,
  "amortization": null,
  "financialExpenses": null,
  "taxes": null
}

Mapeo de campos con terminologia contable colombiana:
- cashAndEquivalents = Efectivo y equivalentes de efectivo
- accountsReceivable = Deudores comerciales / Cuentas por cobrar
- inventories = Inventarios
- totalCurrentAssets = Total activos corrientes
- fixedAssetsProperty = Propiedades, planta y equipo
- totalNonCurrentAssets = Total activos no corrientes
- shortTermFinancialLiabilities = Obligaciones financieras a corto plazo
- suppliers = Proveedores / Cuentas por pagar comerciales
- totalCurrentLiabilities = Total pasivos corrientes
- longTermFinancialLiabilities = Obligaciones financieras a largo plazo
- totalNonCurrentLiabilities = Total pasivos no corrientes
- retainedEarnings = Resultados acumulados / Ganancias retenidas
- netIncome = Resultado del ejercicio / Utilidad neta
- ordinaryActivityRevenue = Ingresos de actividades ordinarias
- costOfSales = Costo de ventas
- administrativeExpenses = Gastos de administracion
- sellingExpenses = Gastos de ventas / distribucion
- depreciation = Depreciacion
- amortization = Amortizacion
- financialExpenses = Gastos financieros
- taxes = Impuesto a las ganancias / Impuesto de renta`;
```

### Respuesta esperada

```json
{
  "balanceSheetDate": "2025-12-31",
  "cashAndEquivalents": 150000000,
  "accountsReceivable1": 820000000,
  "accountsReceivable2": 750000000,
  "inventories1": 430000000,
  "inventories2": 380000000,
  "totalCurrentAssets": 1400000000,
  "fixedAssetsProperty": 2100000000,
  "totalNonCurrentAssets": 2361402235,
  "shortTermFinancialLiabilities": 422285407,
  "suppliers1": 310000000,
  "suppliers2": 280000000,
  "totalCurrentLiabilities": 872888518,
  "longTermFinancialLiabilities": 700000000,
  "totalNonCurrentLiabilities": 700000000,
  "retainedEarnings": 1500000000,
  "netIncome": 688513717,
  "ordinaryActivityRevenue": 4300167300,
  "costOfSales": 2218360648,
  "administrativeExpenses": 850000000,
  "sellingExpenses": 420000000,
  "depreciation": 95000000,
  "amortization": 30000000,
  "financialExpenses": 180000000,
  "taxes": 150000000
}
```

---

## 4. Endpoint 2: Análisis de resultados del estudio de crédito

### Descripción

Recibe los datos calculados del estudio de crédito y genera un análisis ejecutivo en texto.

### Implementación

```typescript
async function analyzeCreditStudy(studyData: CreditStudyData): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildAnalysisUserPrompt(studyData),
      },
    ],
  });

  const textContent = response.content.find((block) => block.type === 'text');
  return textContent?.text || '';
}
```

### System Prompt (análisis)

```typescript
const ANALYSIS_SYSTEM_PROMPT = `Eres un analista de credito senior especializado en evaluacion de riesgo crediticio para empresas colombianas. Tu trabajo es interpretar los resultados de un estudio de credito y generar un analisis claro y accionable.

REGLAS ESTRICTAS:
- Responde UNICAMENTE en espanol
- NO inventes datos ni cifras que no esten en el input
- NO menciones nombres de modelos financieros, formulas o metodologias internas
- NO uses markdown, encabezados ni listas con vinetas. Escribe en parrafos fluidos
- Manten un tono profesional pero accesible, como un informe ejecutivo
- Maximo 4 parrafos
- Formatea los valores monetarios en pesos colombianos con separador de miles (punto) y sin decimales

ESTRUCTURA DE TU RESPUESTA (en parrafos, sin titulos):
1. Diagnostico general: estado financiero de la empresa y veredicto del estudio
2. Capacidad de pago: analisis de si puede cubrir el cupo solicitado y con que margen
3. Plazos y cupo: coherencia entre lo solicitado y lo recomendado, con sugerencias concretas
4. Conclusion: recomendacion final en una oracion`;
```

### User Prompt (template)

```typescript
function buildAnalysisUserPrompt(data: CreditStudyData): string {
  return `DATOS DEL ESTUDIO DE CREDITO:

Cliente: ${data.customerName}
Ciudad: ${data.city}
Antiguedad: ${data.yearsInBusiness} anos

Cupo mensual solicitado: $${formatCOP(data.requestedMonthlyCreditLine)}
Plazo solicitado: ${data.requestedTerm} dias
Cupo recomendado: $${formatCOP(data.recommendedCreditLine)}
Plazo recomendado: ${data.recommendedTerm} dias

Score de viabilidad: ${data.viabilityScore} / 100
Veredicto: ${data.viabilityStatus}

INDICADORES FINANCIEROS:
Ingresos ordinarios: $${formatCOP(data.ordinaryActivityRevenue)}
Utilidad bruta: $${formatCOP(data.grossProfit)}
EBITDA: $${formatCOP(data.ebitda)}
Servicio de deuda actual: $${formatCOP(data.currentDebtService)}
Capacidad de pago mensual: $${formatCOP(data.monthlyPaymentCapacity)}
Capacidad de pago anual: $${formatCOP(data.annualPaymentCapacity)}
Total activos: $${formatCOP(data.totalAssets)}
Total pasivos: $${formatCOP(data.totalLiabilities)}
Patrimonio: $${formatCOP(data.equity)}

EVALUACION POR DIMENSION:
${data.dimensions.map((d) => `- ${d.name}: ${d.score}/${d.maxScore} (${d.status})`).join('\n')}

ALERTAS DEL SISTEMA:
${data.alerts.map((a) => `- [${a.type.toUpperCase()}] ${a.message}`).join('\n')}`;
}
```

---

## 5. Manejo de errores

```typescript
import Anthropic from "@anthropic-ai/sdk";

try {
  const response = await anthropic.messages.create({ ... });
} catch (error) {
  if (error instanceof Anthropic.APIError) {
    switch (error.status) {
      case 400:
        // PDF corrupto o request mal formado
        throw new Error("El documento no pudo ser procesado. Verifique que sea un PDF valido.");
      case 401:
        // API key invalida
        throw new Error("Error de autenticacion con el servicio de IA.");
      case 429:
        // Rate limit - reintentar con backoff
        throw new Error("Servicio temporalmente ocupado. Intente nuevamente.");
      case 529:
        // API sobrecargada
        throw new Error("Servicio no disponible. Intente en unos minutos.");
      default:
        throw new Error("Error inesperado en el servicio de IA.");
    }
  }
  throw error;
}
```

---

## 6. Diferencias clave vs OpenAI

| Concepto       | OpenAI                                                  | Claude (Anthropic)                                   |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| SDK            | `openai`                                                | `@anthropic-ai/sdk`                                  |
| System prompt  | `{ role: "system", content: "..." }` dentro de messages | Parámetro `system` separado en el request            |
| Envío de PDF   | Varía según modelo                                      | `type: "document"` con base64                        |
| Respuesta      | `response.choices[0].message.content`                   | `response.content.find(b => b.type === "text").text` |
| API Key prefix | `sk-...`                                                | `sk-ant-...`                                         |
| Consola        | platform.openai.com                                     | console.anthropic.com                                |

---

## 7. Costos estimados (Haiku 4.5)

| Concepto | Precio            |
| -------- | ----------------- |
| Input    | $0.80 / 1M tokens |
| Output   | $4.00 / 1M tokens |

| Operación                            | Costo estimado       |
| ------------------------------------ | -------------------- |
| Extracción de PDF (por documento)    | ~$0.003 - $0.005     |
| Análisis de resultados (por estudio) | ~$0.002 - $0.003     |
| **Total por estudio completo**       | **~$0.005 - $0.008** |

| Volumen mensual | Costo mensual |
| --------------- | ------------- |
| 50 estudios     | ~$0.40 USD    |
| 200 estudios    | ~$1.60 USD    |
| 1,000 estudios  | ~$8.00 USD    |

---

## 8. Resumen de endpoints

| Endpoint                              | Método | Input                     | Output                       |
| ------------------------------------- | ------ | ------------------------- | ---------------------------- |
| `/api/credit-studies/extract-pdf`     | POST   | PDF (multipart/form-data) | JSON con datos financieros   |
| `/api/credit-studies/:id/ai-analysis` | POST   | Datos del estudio (JSON)  | Texto con análisis ejecutivo |

Ambos endpoints usan el mismo SDK (`@anthropic-ai/sdk`) y el mismo modelo (`claude-haiku-4-5-20251001`).
