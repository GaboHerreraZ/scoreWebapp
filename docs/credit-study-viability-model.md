# Modelo de Viabilidad - Estudio de Credito

## Contexto

La aplicacion realiza estudios de credito para clientes. El usuario ingresa datos financieros (balance general + estado de resultados) y el backend calcula indicadores usando el modelo Z-Score de Altman junto con metricas de capacidad de pago y rotacion.

El objetivo es determinar si un cliente es viable para otorgarle un cupo de credito, y recomendar un plazo y cupo adecuado basado en su situacion financiera real.

---

## 1. Modelo actual (ya implementado en backend)

El backend ya calcula y persiste estos campos en `CreditStudy`:

### Datos de entrada (los ingresa el usuario)

| Campo                                         | Descripcion                             |
| --------------------------------------------- | --------------------------------------- |
| `requestedTerm`                               | Plazo solicitado en dias (ej: 60 dias)  |
| `requestedCreditLine`                  | Cupo de credito total solicitado ($)  |
| `cashAndEquivalents`                          | Efectivo y equivalentes                 |
| `accountsReceivable1` / `accountsReceivable2` | Cuentas por cobrar ano 1 y 2            |
| `inventories1` / `inventories2`               | Inventarios ano 1 y 2                   |
| `totalCurrentAssets`                          | Total activo corriente                  |
| `fixedAssetsProperty`                         | Activos fijos propiedad planta y equipo |
| `totalNonCurrentAssets`                       | Total activo no corriente               |
| `shortTermFinancialLiabilities`               | Obligaciones financieras CP             |
| `suppliers1` / `suppliers2`                   | Proveedores ano 1 y 2                   |
| `totalCurrentLiabilities`                     | Total pasivo corriente                  |
| `longTermFinancialLiabilities`                | Obligaciones financieras LP             |
| `totalNonCurrentLiabilities`                  | Total pasivo no corriente               |
| `retainedEarnings`                            | Ganancias acumuladas                    |
| `ordinaryActivityRevenue`                     | Ingresos de actividades ordinarias      |
| `costOfSales`                                 | Costo de ventas                         |
| `administrativeExpenses`                      | Gastos de administracion                |
| `sellingExpenses`                             | Gastos de ventas                        |
| `depreciation` / `amortization`               | Depreciacion y amortizacion             |
| `financialExpenses`                           | Gastos financieros (intereses)          |
| `taxes`                                       | Impuestos                               |

### Datos calculados (ya los calcula el backend)

| Campo                        | Descripcion                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `totalAssets`                | Total activo                                                                                |
| `totalLiabilities`           | Total pasivo                                                                                |
| `equity`                     | Patrimonio = Activo - Pasivo                                                                |
| `grossProfit`                | Utilidad bruta = Ingresos - Costo ventas                                                    |
| `netIncome`                  | Utilidad neta                                                                               |
| `stabilityFactor`            | Factor de estabilidad (1, 0.66 o 0.33) derivado del Puntaje Z de Altman                     |
| `ebitda`                     | EBITDA                                                                                      |
| `adjustedEbitda`             | EBITDA ajustado (EBITDA \* stabilityFactor)                                                 |
| `currentDebtService`         | Servicio de deuda actual (Obligaciones CP + LP + Gastos financieros)                        |
| `annualPaymentCapacity`      | Capacidad de pago anual = adjustedEbitda - currentDebtService                               |
| `monthlyPaymentCapacity`     | Capacidad de pago mensual = annualPaymentCapacity / 12                                      |
| `accountsReceivableTurnover` | Rotacion de cartera (dias)                                                                  |
| `inventoryTurnover`          | Rotacion de inventarios (dias)                                                              |
| `suppliersTurnover`          | Rotacion de proveedores (dias)                                                              |
| `paymentTimeSuppliers`         | Tiempo maximo en pagar (dias) = rotacionCartera + rotacionInventarios + rotacionProveedores |
| `averagePaymentTime`         | Tiempo promedio en pagar (dias)                                                             |

### Puntaje Z de Altman (referencia interna, NO exponer al cliente)

```
X1 = (Activo Corriente - Pasivo Corriente) / Activo Total
X2 = Ganancias Acumuladas / Activo Total
X3 = Utilidad Operacional / Activo Total
     donde Utilidad Operacional = Utilidad Bruta - Gastos Admin - Gastos Ventas
X4 = Patrimonio / Pasivo Total
X5 = Ingresos Actividades Ordinarias / Activo Total

Z = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + X5

Si Z > 3.0           -> stabilityFactor = 1.0   (zona segura)
Si 1.8 < Z <= 3.0    -> stabilityFactor = 0.66  (zona gris)
Si Z <= 1.8          -> stabilityFactor = 0.33  (zona de riesgo)
```

---

## 2. Nuevos campos a agregar al modelo CreditStudy

Estos campos se calculan en el backend al momento de ejecutar `performCreditStudy`, usando los datos que ya existen:

```typescript
// Agregar a la entidad/tabla CreditStudy
recommendedTerm?: number;           // Plazo recomendado (dias)
recommendedCreditLine?: number;     // Cupo recomendado ($)
viabilityScore?: number;            // 0-100 score consolidado
viabilityStatus?: string;           // 'approved' | 'conditional' | 'rejected'
viabilityConditions?: string;       // JSON con alertas/condiciones (ver estructura abajo)
```

---

## 3. Sistema de viabilidad: 4 Dimensiones

### Dimension 1: Salud financiera (basada en Puntaje Z)

| Condicion                       | Resultado   | Puntaje parcial |
| ------------------------------- | ----------- | --------------- |
| Z > 3.0 (`stabilityFactor = 1`) | Saludable   | 25/25           |
| 1.8 < Z <= 3.0                  | Zona gris   | 12/25           |
| Z <= 1.8                        | Riesgo alto | 0/25            |

### Dimension 2: Capacidad de pago

```
ratio = monthlyPaymentCapacity / requestedCreditLine
```

| Condicion                  | Resultado                       | Puntaje parcial |
| -------------------------- | ------------------------------- | --------------- |
| ratio >= 1.2 (>20% margen) | Holgado                         | 25/25           |
| ratio >= 1.0 y < 1.2       | Ajustado                        | 15/25           |
| ratio < 1.0                | **Insuficiente (ELIMINATORIO)** | 0/25            |

**NOTA:** Si la capacidad de pago es insuficiente, el estudio se rechaza automaticamente sin importar las demas dimensiones.

### Dimension 3: Coherencia de plazos

```
El plazo solicitado debe ser coherente con los tiempos reales de cobro del cliente.
```

| Condicion                                   | Resultado   | Puntaje parcial |
| ------------------------------------------- | ----------- | --------------- |
| `requestedTerm >= paymentTimeSuppliers`       | Coherente   | 25/25           |
| `requestedTerm >= paymentTimeSuppliers * 0.7` | Riesgoso    | 12/25           |
| `requestedTerm < paymentTimeSuppliers * 0.5`  | Incoherente | 0/25            |

**Caso especial:** Si `paymentTimeSuppliers` es negativo o cero (dato anomalo), usar `accountsReceivableTurnover` como referencia alternativa.

### Dimension 4: Cupo recomendado vs. solicitado

```
recommendedCreditLine = monthlyPaymentCapacity * (recommendedTerm / 30)
ratio = requestedCreditLine / recommendedCreditLine
```

| Condicion                         | Resultado            | Puntaje parcial |
| --------------------------------- | -------------------- | --------------- |
| ratio <= 1.0 (dentro de rango)    | Adecuado             | 25/25           |
| ratio <= 1.3 (hasta 30% excedido) | Ligeramente excedido | 15/25           |
| ratio > 1.3                       | Excesivo             | 0/25            |

---

## 4. Calculo del veredicto final

### viabilityScore (0-100)

```
viabilityScore = sumaDePuntajesParciales (maximo 100)
```

### viabilityStatus

| Condicion                                    | Veredicto                     |
| -------------------------------------------- | ----------------------------- |
| Capacidad de pago insuficiente (ratio < 1.0) | **`rejected`** (eliminatorio) |
| viabilityScore >= 75                         | **`approved`**                |
| viabilityScore >= 40 y < 75                  | **`conditional`**             |
| viabilityScore < 40                          | **`rejected`**                |

### recommendedTerm (plazo recomendado)

El plazo recomendado se basa en la rotacion de cartera, pero con dos cotas:

- **Piso minimo de 30 dias:** un credito comercial nunca debe tener plazo menor a un mes, aunque el cliente cobre casi de contado (ej: colegios, retail con cobro inmediato).
- **Respeta el plazo solicitado:** si el cliente pide un plazo mayor y el cupo es viable en ese plazo, no se penaliza forzando uno mas corto. De lo contrario, una rotacion de cartera muy rapida reduciria artificialmente el cupo recomendado.

```
MIN_RECOMMENDED_TERM = 30

Si accountsReceivableTurnover > 0:
    recommendedTerm = max(accountsReceivableTurnover, requestedTerm, MIN_RECOMMENDED_TERM)
Si accountsReceivableTurnover <= 0 (dato anomalo):
    recommendedTerm = max(requestedTerm, MIN_RECOMMENDED_TERM)
```

### recommendedCreditLine (cupo recomendado)

Nunca supera lo solicitado: si la empresa puede pagar mas, simplemente se aprueba el cupo solicitado.

```
maxAffordableCredit  = monthlyPaymentCapacity * (recommendedTerm / 30)
recommendedCreditLine = min(requestedCreditLine, maxAffordableCredit)
```

---

## 5. Estructura de viabilityConditions (JSON)

**IMPORTANTE:** Este JSON se construye ENTERAMENTE en el backend al ejecutar `performCreditStudy`. El frontend solo lo recibe y renderiza. Nunca debe existir logica de calculo de viabilidad en el frontend.

### Tipos de alerta

| `type`    | Uso                              | Color sugerido frontend |
| --------- | -------------------------------- | ----------------------- |
| `danger`  | Condicion eliminatoria o critica | Rojo                    |
| `warning` | Riesgo que requiere atencion     | Amarillo/Naranja        |
| `info`    | Dato informativo o recomendacion | Azul                    |
| `success` | Indicador positivo               | Verde                   |

### Reglas de generacion de alertas por dimension

#### Dimension 1: Salud financiera (`financialHealth`)

| Condicion      | type      | Mensaje                                                                                                         |
| -------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| Z > 3.0        | `success` | "La empresa presenta indicadores financieros solidos con baja probabilidad de riesgo."                          |
| 1.8 < Z <= 3.0 | `warning` | "La empresa se encuentra en zona de observacion. Se recomienda monitoreo periodico de sus estados financieros." |
| Z <= 1.8       | `danger`  | "La empresa presenta indicadores financieros criticos con alta probabilidad de incumplimiento."                 |

#### Dimension 2: Capacidad de pago (`paymentCapacity`)

| Condicion                   | type      | Mensaje                                                                                                                                                                                         |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ratio >= 1.2                | `success` | "La capacidad de pago mensual (${monthlyPaymentCapacity}) supera ampliamente el cupo solicitado (${requestedCreditLine}) con un margen del {margen}%."                                   |
| ratio >= 1.0 y < 1.2        | `warning` | "La capacidad de pago mensual (${monthlyPaymentCapacity}) cubre el cupo solicitado (${requestedCreditLine}) con un margen ajustado del {margen}%. Se recomienda no incrementar el cupo." |
| ratio < 1.0                 | `danger`  | "La capacidad de pago mensual (${monthlyPaymentCapacity}) es insuficiente para cubrir el cupo solicitado (${requestedCreditLine}). Deficit del {deficit}%."                              |
| monthlyPaymentCapacity <= 0 | `danger`  | "El cliente no cuenta con capacidad de pago. El servicio de deuda actual (${currentDebtService}) supera el EBITDA ajustado."                                                                    |

#### Dimension 3: Coherencia de plazos (`termCoherence`)

| Condicion                        | type      | Mensaje                                                                                                                                                                   |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| requestedTerm >= realTerm        | `success` | "El plazo solicitado ({requestedTerm} dias) es coherente con los tiempos de operacion del cliente."                                                                       |
| requestedTerm >= realTerm \* 0.7 | `warning` | "El plazo solicitado ({requestedTerm} dias) es inferior a los tiempos reales de operacion ({realTerm} dias). Se recomienda un plazo de al menos {realTerm} dias."         |
| requestedTerm < realTerm \* 0.5  | `danger`  | "El plazo solicitado ({requestedTerm} dias) es significativamente inferior a los tiempos reales de operacion ({realTerm} dias). Alto riesgo de incumplimiento en plazos." |
| paymentTimeSuppliers <= 0          | `info`    | "Los tiempos de rotacion presentan valores atipicos. El analisis de plazos se basa en la rotacion de cartera ({accountsReceivableTurnover} dias) como referencia."        |

**Nota:** Cuando `paymentTimeSuppliers <= 0`, se usa `accountsReceivableTurnover` como `realTerm`. Una dimension puede generar multiples alertas (ej: una `danger` por incoherencia + una `info` por dato atipico).

#### Dimension 4: Cupo (`creditLineAdequacy`)

| Condicion    | type      | Mensaje                                                                                                                                 |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ratio <= 1.0 | `success` | "El cupo solicitado se encuentra dentro del rango recomendado. Cupo maximo sugerido: ${recommendedCreditLine}."                         |
| ratio <= 1.3 | `warning` | "El cupo solicitado excede en un {exceso}% el cupo recomendado (${recommendedCreditLine}). Se sugiere ajustar a este valor."            |
| ratio > 1.3  | `danger`  | "El cupo solicitado excede significativamente el cupo recomendado (${recommendedCreditLine}) en un {exceso}%. Se recomienda reducirlo." |

### Alertas adicionales (cross-dimension, generadas por el backend)

| Condicion                                                | type      | dimension | Mensaje                                                                                                                                       |
| -------------------------------------------------------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| viabilityStatus === 'conditional'                        | `info`    | `general` | "El estudio es aprobable sujeto a las condiciones indicadas. Revise las recomendaciones de plazo y cupo."                                     |
| viabilityStatus === 'rejected' y solo falla por plazos   | `info`    | `general` | "El cliente podria ser viable con un plazo de {recommendedTerm} dias en lugar de {requestedTerm} dias."                                       |
| annualPaymentCapacity < requestedCreditLine \* 12 | `warning` | `general` | "La capacidad de pago anual (${annualPaymentCapacity}) no cubre 12 meses del cupo solicitado. Considerar un cupo menor o un plazo mas corto." |
| inventoryTurnover === 0                                  | `info`    | `general` | "No se registra rotacion de inventarios. Verifique si el tipo de negocio del cliente aplica para este indicador."                             |

### JSON completo de ejemplo (caso real)

```json
{
  "dimensions": {
    "financialHealth": {
      "score": 25,
      "maxScore": 25,
      "status": "healthy",
      "label": "Salud Financiera"
    },
    "paymentCapacity": {
      "score": 15,
      "maxScore": 25,
      "status": "tight",
      "ratio": 1.197,
      "marginPercent": 19.7,
      "label": "Capacidad de Pago"
    },
    "termCoherence": {
      "score": 0,
      "maxScore": 25,
      "status": "incoherent",
      "requestedTerm": 60,
      "realTerm": 104,
      "label": "Coherencia de Plazos"
    },
    "creditLineAdequacy": {
      "score": 25,
      "maxScore": 25,
      "status": "adequate",
      "ratio": 0.83,
      "label": "Adecuación del Cupo"
    }
  },
  "alerts": [
    {
      "type": "success",
      "dimension": "financialHealth",
      "message": "La empresa presenta indicadores financieros solidos con baja probabilidad de riesgo."
    },
    {
      "type": "warning",
      "dimension": "paymentCapacity",
      "message": "La capacidad de pago mensual ($17,951,266) cubre el cupo solicitado ($15,000,000) con un margen ajustado del 19.7%. Se recomienda no incrementar el cupo."
    },
    {
      "type": "danger",
      "dimension": "termCoherence",
      "message": "El plazo solicitado (60 dias) es significativamente inferior a los tiempos reales de operacion (104 dias). Alto riesgo de incumplimiento en plazos."
    },
    {
      "type": "info",
      "dimension": "termCoherence",
      "message": "Los tiempos de rotacion presentan valores atipicos. El analisis de plazos se basa en la rotacion de cartera (104 dias) como referencia."
    },
    {
      "type": "success",
      "dimension": "creditLineAdequacy",
      "message": "El cupo solicitado se encuentra dentro del rango recomendado. Cupo maximo sugerido: $62,230,388."
    },
    {
      "type": "info",
      "dimension": "general",
      "message": "El estudio es aprobable sujeto a las condiciones indicadas. Revise las recomendaciones de plazo y cupo."
    }
  ],
  "summary": {
    "totalScore": 65,
    "maxScore": 100,
    "status": "conditional",
    "recommendedTerm": 104,
    "recommendedCreditLine": 62230388,
    "monthlyPaymentCapacity": 17951266,
    "annualPaymentCapacity": 215415193
  }
}
```

### Pseudocodigo del backend para construir viabilityConditions

```
function buildViabilityConditions(study: CreditStudy): ViabilityConditions {
  const alerts = [];
  const dimensions = {};

  // 1. Salud financiera
  const zScore = calculateZScore(study);
  if (zScore > 3.0) {
    dimensions.financialHealth = { score: 25, maxScore: 25, status: "healthy", label: "Salud Financiera" };
    alerts.push({ type: "success", dimension: "financialHealth", message: "..." });
  } else if (zScore > 1.8) {
    dimensions.financialHealth = { score: 12, maxScore: 25, status: "gray_zone", label: "Salud Financiera" };
    alerts.push({ type: "warning", dimension: "financialHealth", message: "..." });
  } else {
    dimensions.financialHealth = { score: 0, maxScore: 25, status: "critical", label: "Salud Financiera" };
    alerts.push({ type: "danger", dimension: "financialHealth", message: "..." });
  }

  // 2. Capacidad de pago
  const paymentRatio = study.monthlyPaymentCapacity / study.requestedCreditLine;
  const marginPercent = round((paymentRatio - 1) * 100, 1);
  // ... evaluar y generar alertas

  // 3. Coherencia de plazos
  let realTerm = study.paymentTimeSuppliers;
  if (realTerm <= 0) {
    realTerm = study.accountsReceivableTurnover;
    alerts.push({ type: "info", dimension: "termCoherence", message: "datos atipicos..." });
  }
  // ... evaluar requestedTerm vs realTerm

  // 4. Cupo recomendado
  const recommendedTerm = realTerm > 0 ? realTerm : study.requestedTerm;
  const recommendedCreditLine = study.monthlyPaymentCapacity * (recommendedTerm / 30);
  const creditRatio = study.requestedCreditLine / recommendedCreditLine;
  // ... evaluar y generar alertas

  // 5. Alertas cross-dimension
  // ... evaluar condiciones generales

  // 6. Calcular score y status
  const totalScore = sum(dimensions.*.score);
  let status = "rejected";
  if (paymentRatio < 1.0) status = "rejected";  // ELIMINATORIO
  else if (totalScore >= 75) status = "approved";
  else if (totalScore >= 40) status = "conditional";

  return {
    dimensions,
    alerts,
    summary: { totalScore, maxScore: 100, status, recommendedTerm, recommendedCreditLine, ... }
  };
}
```

---

## 6. Que mostrar al usuario en el frontend vs. que ocultar

### MOSTRAR (pantalla de resultados del estudio)

| Seccion                   | Datos                                                                     | Notas                           |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| **Veredicto general**     | Badge: Aprobado (verde) / Condicionado (azul-amarillo) / Rechazado (rojo) | Lo primero que ve el usuario    |
| **Score visual**          | Barra o gauge de 0-100                                                    | Sin revelar formula             |
| **Capacidad de pago**     | Mensual y Anual en $                                                      | Dato estandar, no revela modelo |
| **Cupo recomendado**      | Monto en $                                                                | Valor agregado clave            |
| **Plazo recomendado**     | Dias                                                                      | Valor agregado clave            |
| **EBITDA**                | Monto en $                                                                | Indicador estandar              |
| **Servicio de deuda**     | Monto en $                                                                | Contexto de compromisos         |
| **Alertas/Banderas**      | Mensajes descriptivos del array `alerts`                                  | Advierte sin revelar formulas   |
| **Resumen por dimension** | 4 cards con score parcial (ej: "Capacidad de Pago: 15/25")                | Visual, sin formula             |

### OCULTAR (nunca enviar al frontend)

| Dato                                        | Razon                                  |
| ------------------------------------------- | -------------------------------------- |
| `stabilityFactor` (valor crudo)             | Revela que usas Altman Z-Score         |
| Valores X1-X5                               | Son las razones financieras del modelo |
| Formula del Puntaje Z                       | Propiedad intelectual                  |
| Rotaciones crudas (numeros exactos)         | Solo mostrar interpretacion/alertas    |
| `adjustedEbitda` vs `ebitda` (comparacion)  | Revela que ajustas por estabilidad     |
| Umbrales internos (1.8, 3.0, 0.7, 1.2, 1.3) | Revelan la logica de decision          |

---

## 7. Ejemplo real evaluado

### Datos del cliente

```
Cupo solicitado mensual: $15,000,000
Plazo solicitado: 60 dias
Capacidad de pago mensual: $17,951,266
EBITDA: $637,700,600
Rotacion de cartera: 104 dias
Tiempo maximo en pagar: -1 (anomalo)
```

### Evaluacion por dimension

1. **Salud financiera:** 25/25 - Saludable (Z > 3.0)
2. **Capacidad de pago:** 15/25 - Ajustado (ratio = 1.197, margen 19.7%)
3. **Coherencia de plazos:** 0/25 - Incoherente (pide 60d, rotacion cartera 104d, tiempo maximo anomalo)
4. **Cupo recomendado:** 25/25 - Dentro de rango

### Resultado

```
viabilityScore: 65/100
viabilityStatus: "conditional"
recommendedTerm: 104 dias (basado en rotacion de cartera, porque paymentTimeSuppliers es anomalo)
recommendedCreditLine: $17,951,266 * (104/30) = $62,230,388
```

**Veredicto: APROBADO CON CONDICIONES**

- Sugerir plazo de al menos 104 dias
- El cupo mensual solicitado es viable pero ajustado

### Ejemplo: Cliente con rotacion de cartera muy baja

Caso real: una empresa tipo colegio con cobro casi de contado (rotacion de cartera = 2 dias). Sin las cotas descritas en `recommendedTerm`, el plazo recomendado se forzaria a 2 dias y el cupo recomendado quedaria artificialmente reducido a `monthlyPaymentCapacity * (2/30)`, contradiciendo la dimension 4 que ya aprobo el plazo solicitado.

```
Cupo solicitado: $10,000,000
Plazo solicitado: 60 dias
Capacidad de pago mensual: $98,056,389
Rotacion de cartera: 2 dias
```

Aplicando las cotas:

```
recommendedTerm = max(2, 60, 30) = 60 dias
maxAffordableCredit = 98,056,389 * (60/30) = $196,112,778
recommendedCreditLine = min(10,000,000, 196,112,778) = $10,000,000
```

El cupo recomendado coincide con lo solicitado, consistente con que las 4 dimensiones obtuvieron 25/25.

---

## 8. Integracion futura con IA (GPT-4o mini)

Agregar un campo adicional al modelo:

```typescript
aiAnalysis?: string;  // Texto generado por IA, se guarda una sola vez al realizar el estudio
```

La IA recibira los datos del estudio + el resultado de viabilidad y generara un analisis narrativo en espanol. Este analisis se persiste para no re-llamar la API cada vez que se consulta el estudio.

**Costo estimado:** ~$0.0006 USD por analisis (~$2.5 COP).

**Modelo de cobro sugerido:** Agregar `maxAIAnalysisPerMonth` al plan de suscripcion, usando la misma logica de limites que ya existe con `maxStudiesPerMonth`.
