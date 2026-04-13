# Implementacion de Analisis IA - Backend (NestJS)

## 1. Cuenta y API Key de OpenAI

### Crear cuenta

1. Ir a **https://platform.openai.com/signup**
2. Registrarse con email o cuenta de Google/Microsoft
3. Verificar email y numero de telefono

### Configurar facturacion

1. Ir a **https://platform.openai.com/account/billing/overview**
2. Agregar metodo de pago (tarjeta de credito/debito)
3. Configurar un limite mensual de gasto (Settings > Limits). Recomendado: **$5 USD/mes** como tope inicial (cubre ~8,300 analisis)

### Generar API Key

1. Ir a **https://platform.openai.com/api-keys**
2. Click en "Create new secret key"
3. Nombre: `credit-study-ai-production` (o el que prefieras)
4. Permisos: **"All"** o al menos **"Model capabilities > Write"**
5. Copiar la key inmediatamente (no se vuelve a mostrar)
6. Guardarla en las variables de entorno del backend como `OPENAI_API_KEY`

---

## 2. Dependencias a instalar

```bash
npm install openai
```

Esa es la unica dependencia necesaria. El SDK oficial de OpenAI para Node.js (`openai` v4+) maneja autenticacion, reintentos, tipado y streaming.

---

## 3. Variables de entorno

Agregar al `.env` del backend:

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=1024
```

---

## 4. Modulo de IA

### 4.1 Estructura de archivos

```
src/
  ai/
    ai.module.ts
    ai.service.ts
    prompts/
      credit-study-analysis.prompt.ts
```

### 4.2 `ai.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AiService } from './ai.service';

@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
```

### 4.3 `ai.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(private configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    this.maxTokens = this.configService.get<number>('OPENAI_MAX_TOKENS', 1024);
  }

  async generateCompletion(
    systemPrompt: string,
    userMessage: string,
  ): Promise<string | null> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      return response.choices[0]?.message?.content ?? null;
    } catch (error) {
      this.logger.error('Error calling OpenAI API', error);
      return null;
    }
  }
}
```

**Notas sobre parametros:**

- `temperature: 0.3` — Baja para respuestas consistentes y factuales (no creativas)
- `max_tokens: 1024` — Suficiente para un analisis de ~3-4 parrafos

### 4.4 `prompts/credit-study-analysis.prompt.ts`

```typescript
export const CREDIT_STUDY_SYSTEM_PROMPT = `Eres un analista de credito senior especializado en evaluacion de riesgo crediticio para empresas colombianas. Tu trabajo es interpretar los resultados de un estudio de credito y generar un analisis claro y accionable.

REGLAS ESTRICTAS:
- Responde UNICAMENTE en espanol
- NO inventes datos ni cifras que no esten en el input
- NO menciones nombres de modelos financieros, formulas o metodologias internas
- NO uses markdown, encabezados ni listas con viñetas. Escribe en parrafos fluidos
- Manten un tono profesional pero accesible, como un informe ejecutivo
- Maximo 4 parrafos
- Formatea los valores monetarios en pesos colombianos con separador de miles (punto) y sin decimales

ESTRUCTURA DE TU RESPUESTA (en parrafos, sin titulos):
1. Diagnostico general: estado financiero de la empresa y veredicto del estudio
2. Capacidad de pago: analisis de si puede cubrir el cupo solicitado y con que margen
3. Plazos y cupo: coherencia entre lo solicitado y lo recomendado, con sugerencias concretas
4. Conclusion: recomendacion final en una oracion`;

export function buildCreditStudyUserMessage(study: {
  customerName: string;
  customerCity: string;
  seniority: number;
  requestedTerm: number;
  requestedCreditLine: number;
  viabilityScore: number;
  viabilityStatus: string;
  recommendedTerm: number;
  recommendedCreditLine: number;
  monthlyPaymentCapacity: number;
  annualPaymentCapacity: number;
  ebitda: number;
  currentDebtService: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  ordinaryActivityRevenue: number;
  grossProfit: number;
  netIncome: number;
  viabilityConditions: {
    dimensions: Record<
      string,
      { score: number; maxScore: number; status: string; label: string }
    >;
    alerts: Array<{ type: string; dimension: string; message: string }>;
    summary: { totalScore: number; maxScore: number; status: string };
  };
}): string {
  const dims = study.viabilityConditions.dimensions;
  const alerts = study.viabilityConditions.alerts;

  return `DATOS DEL ESTUDIO DE CREDITO:

Cliente: ${study.customerName}
Ciudad: ${study.customerCity}
Antiguedad: ${study.seniority} anos

Cupo mensual solicitado: $${study.requestedCreditLine.toLocaleString('es-CO')}
Plazo solicitado: ${study.requestedTerm} dias
Cupo recomendado: $${study.recommendedCreditLine.toLocaleString('es-CO')}
Plazo recomendado: ${study.recommendedTerm} dias

Score de viabilidad: ${study.viabilityScore} / 100
Veredicto: ${study.viabilityStatus === 'approved' ? 'APROBADO' : study.viabilityStatus === 'conditional' ? 'APROBADO CON CONDICIONES' : 'NO APROBADO'}

INDICADORES FINANCIEROS:
Ingresos ordinarios: $${study.ordinaryActivityRevenue.toLocaleString('es-CO')}
Utilidad bruta: $${study.grossProfit.toLocaleString('es-CO')}
EBITDA: $${study.ebitda.toLocaleString('es-CO')}
Servicio de deuda actual: $${study.currentDebtService.toLocaleString('es-CO')}
Capacidad de pago mensual: $${study.monthlyPaymentCapacity.toLocaleString('es-CO')}
Capacidad de pago anual: $${study.annualPaymentCapacity.toLocaleString('es-CO')}
Total activos: $${study.totalAssets.toLocaleString('es-CO')}
Total pasivos: $${study.totalLiabilities.toLocaleString('es-CO')}
Patrimonio: $${study.equity.toLocaleString('es-CO')}

EVALUACION POR DIMENSION:
${Object.values(dims)
  .map((d) => `- ${d.label}: ${d.score}/${d.maxScore} (${d.status})`)
  .join('\n')}

ALERTAS DEL SISTEMA:
${alerts.map((a) => `- [${a.type.toUpperCase()}] ${a.message}`).join('\n')}`;
}
```

---

## 5. Integracion con el servicio de Credit Study

### 5.1 Nuevo campo en la entidad

Agregar a la entidad `CreditStudy`:

```typescript
@Column({ type: 'text', nullable: true })
aiAnalysis: string | null;
```

Migracion:

```sql
ALTER TABLE credit_study ADD COLUMN ai_analysis TEXT NULL;
```

### 5.2 Importar AiModule en CreditStudyModule

```typescript
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CreditStudy]),
    AiModule, // <-- agregar
    // ... otros imports
  ],
  // ...
})
export class CreditStudyModule {}
```

### 5.3 Llamar al servicio en `performCreditStudy`

Dentro del metodo `performCreditStudy` del servicio de credit study, **despues** de calcular `viabilityConditions` y **antes** de guardar:

```typescript
import { AiService } from '../ai/ai.service';
import { CREDIT_STUDY_SYSTEM_PROMPT, buildCreditStudyUserMessage } from '../ai/prompts/credit-study-analysis.prompt';

// En el constructor:
constructor(
  // ... otros inyectados
  private readonly aiService: AiService,
) {}

// Dentro de performCreditStudy, despues de calcular viabilidad:
async performCreditStudy(id: string): Promise<CreditStudy> {
  // ... codigo existente que calcula viabilityConditions ...

  // Generar analisis IA (no bloquea el flujo si falla)
  try {
    const customer = await this.getCustomerForStudy(study);
    const userMessage = buildCreditStudyUserMessage({
      customerName: customer.businessName,
      customerCity: customer.city,
      seniority: customer.seniority,
      requestedTerm: study.requestedTerm,
      requestedCreditLine: study.requestedCreditLine,
      viabilityScore: study.viabilityScore,
      viabilityStatus: study.viabilityStatus,
      recommendedTerm: study.recommendedTerm,
      recommendedCreditLine: study.recommendedCreditLine,
      monthlyPaymentCapacity: study.monthlyPaymentCapacity,
      annualPaymentCapacity: study.annualPaymentCapacity,
      ebitda: study.ebitda,
      currentDebtService: study.currentDebtService,
      totalAssets: study.totalAssets,
      totalLiabilities: study.totalLiabilities,
      equity: study.equity,
      ordinaryActivityRevenue: study.ordinaryActivityRevenue,
      grossProfit: study.grossProfit,
      netIncome: study.netIncome,
      viabilityConditions: study.viabilityConditions,
    });

    const aiAnalysis = await this.aiService.generateCompletion(
      CREDIT_STUDY_SYSTEM_PROMPT,
      userMessage,
    );

    study.aiAnalysis = aiAnalysis;
  } catch (error) {
    this.logger.warn('AI analysis failed, saving study without it', error);
    study.aiAnalysis = null;
  }

  // Guardar estudio con todos los datos
  return this.creditStudyRepository.save(study);
}
```

**Importante:** El analisis de IA es un complemento. Si la API de OpenAI falla o esta lenta, el estudio se guarda igual sin el analisis. El usuario puede ver el resultado con las dimensiones y alertas normalmente.

---

## 6. Respuesta al frontend

El campo `aiAnalysis` se incluye automaticamente en la respuesta del `GET /credit-study/:id` ya que es parte de la entidad. No necesitas cambiar el endpoint.

El JSON de respuesta incluira:

```json
{
  "id": "619fa297-...",
  "viabilityScore": 65,
  "viabilityStatus": "conditional",
  "viabilityConditions": { ... },
  "aiAnalysis": "La empresa MEDICID, ubicada en Giron con 15 anos de trayectoria, presenta una situacion financiera solida con activos por $3.761.402.235 y un patrimonio de $2.188.513.717 que respaldan ampliamente sus obligaciones...",
  ...
}
```

Si `aiAnalysis` es `null`, el frontend simplemente no muestra esa seccion.

---

## 7. Ejemplo de respuesta esperada de GPT-4o mini

Dado el estudio real del ejemplo (MEDICID, score 65, conditional):

> La empresa MEDICID, ubicada en Giron con 15 anos de trayectoria, presenta una situacion financiera solida con activos totales por $3.761.402.235 y un patrimonio de $2.188.513.717. El estudio arroja un puntaje de 65 sobre 100, resultando en una aprobacion condicionada del cupo de credito.
>
> En terminos de capacidad de pago, la empresa genera un EBITDA de $637.700.600 y una capacidad de pago mensual de $17.951.266, lo cual cubre el cupo solicitado de $15.000.000 con un margen del 19.7%. Si bien la cobertura es positiva, el margen es ajustado y no se recomienda incrementar el cupo por encima de este valor.
>
> El punto critico del analisis esta en los plazos: el cupo fue solicitado a 60 dias, pero los tiempos reales de operacion del negocio indican un ciclo de 164 dias. Esta diferencia significativa genera un riesgo alto de incumplimiento en los plazos pactados. Se recomienda ajustar el plazo a un minimo de 164 dias para alinear la obligacion con la realidad operativa de la empresa. El cupo maximo recomendado bajo este plazo seria de $98.133.587, muy por encima del monto solicitado.
>
> Se recomienda aprobar el cupo de $15.000.000 con la condicion de ajustar el plazo de pago a 164 dias para garantizar el cumplimiento oportuno de la obligacion.

---

## 8. Costos estimados

| Item                           | Valor                    |
| ------------------------------ | ------------------------ |
| Tokens de entrada por analisis | ~600-800 tokens          |
| Tokens de salida por analisis  | ~300-500 tokens          |
| Costo por analisis             | ~$0.0006 USD (~$2.5 COP) |
| 100 analisis/mes               | ~$0.06 USD (~$250 COP)   |
| 1,000 analisis/mes             | ~$0.60 USD (~$2,500 COP) |

---

## 9. Control de uso por suscripcion (opcional)

Si decides limitar analisis IA por plan, agregar a la tabla de suscripciones:

```sql
ALTER TABLE subscription_plan ADD COLUMN max_ai_analysis_per_month INTEGER DEFAULT 0;
```

Y validar antes de llamar a la API:

```typescript
// En performCreditStudy, antes de llamar a aiService:
const usage = await this.subscriptionService.getAiUsageThisMonth(companyId);
const plan = await this.subscriptionService.getActivePlan(companyId);

if (plan.maxAiAnalysisPerMonth > 0 && usage >= plan.maxAiAnalysisPerMonth) {
  this.logger.warn('AI analysis limit reached for company', companyId);
  study.aiAnalysis = null; // No generar analisis, pero el estudio se guarda normal
} else {
  // ... llamar a aiService ...
  await this.subscriptionService.incrementAiUsage(companyId);
}
```

---

## 10. Checklist de implementacion

- [ ] Crear cuenta en https://platform.openai.com/signup
- [ ] Configurar facturacion y limite mensual
- [ ] Generar API key
- [ ] `npm install openai`
- [ ] Agregar variables de entorno (`OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_TOKENS`)
- [ ] Crear `src/ai/ai.module.ts`
- [ ] Crear `src/ai/ai.service.ts`
- [ ] Crear `src/ai/prompts/credit-study-analysis.prompt.ts`
- [ ] Agregar columna `ai_analysis` a la tabla `credit_study`
- [ ] Importar `AiModule` en `CreditStudyModule`
- [ ] Integrar llamada en `performCreditStudy`
- [ ] Agregar campo `aiAnalysis` al tipo del frontend
- [ ] Crear seccion en el componente de resultado para mostrar el analisis
- [ ] (Opcional) Implementar control de uso por suscripcion
