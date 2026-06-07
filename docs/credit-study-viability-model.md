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
| `monthlyPaymentCapacity`     | Capacidad de pago mensual = annualPaymentCapacity / meses del periodo                       |
| `accountsReceivableTurnover` | Rotacion de cartera (dias)                                                                  |
| `inventoryTurnover`          | Rotacion de inventarios (dias)                                                              |
| `suppliersTurnover`          | Rotacion de proveedores (dias)                                                              |
| `paymentTimeSuppliers`       | Tiempo de pago a proveedores (dias)                                                         |
| `cashConversionCycle` (CCC)  | Ciclo de conversion de efectivo = rotacionCartera + rotacionInventarios - tiempoPagoProveedores. Plazo natural del negocio; umbral de exposicion (Dimension 5) |

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
recommendedTerm?: number;           // Plazo recomendado (dias) — nunca mayor al solicitado
recommendedCreditLine?: number;     // Cupo recomendado ($)
cashConversionCycle?: number;       // Ciclo de conversion de efectivo (dias) — umbral de exposicion
viabilityScore?: number;            // 0-100 score consolidado (5 dimensiones x 20)
viabilityStatus?: string;           // 'approved' | 'conditional' | 'rejected'
viabilityConditions?: string;       // JSON con alertas/condiciones (ver estructura abajo)
```

> El `cashConversionCycle` puede persistirse o calcularse al vuelo; se usa internamente para la Dimension 5 y para el plazo recomendado. No se expone como valor crudo al frontend (ver seccion 6).

---

## 3. Sistema de viabilidad: 5 Dimensiones

> **Cambio de version:** El modelo paso de 4 dimensiones de 25 puntos a **5 dimensiones de 20 puntos** (total 100). Se agrego la Dimension 5 (Exposicion / Eficiencia del Capital) para incorporar la perspectiva del **prestamista** en un credito comercial **sin intereses**. Cuatro dimensiones evaluan al cliente; la quinta evalua el interes de la empresa que presta. El documento autoritativo de la metodologia completa es `credit-study-scoring-methodology.md`.

### Dimension 1: Salud financiera (basada en Puntaje Z) — 20 pts

| Condicion                       | Resultado   | Puntaje parcial |
| ------------------------------- | ----------- | --------------- |
| Z > 3.0 (`stabilityFactor = 1`) | Saludable   | 20/20           |
| 1.8 < Z <= 3.0                  | Zona gris   | 10/20           |
| Z <= 1.8                        | Riesgo alto | 0/20            |

### Dimension 2: Capacidad de pago — 20 pts

La cuota mensual estimada integra el cupo Y el plazo. El ratio compara la capacidad mensual del cliente contra esa cuota:

```
cuotaMensual = requestedCreditLine / (requestedTerm / 30)
ratio = monthlyPaymentCapacity / cuotaMensual
```

| Condicion                  | Resultado                       | Puntaje parcial |
| -------------------------- | ------------------------------- | --------------- |
| ratio >= 1.2 (>20% margen) | Holgado                         | 20/20           |
| ratio >= 1.0 y < 1.2       | Ajustado                        | 12/20           |
| ratio < 1.0                | Insuficiente                    | 0/20            |
| monthlyPaymentCapacity <= 0 | **Sin capacidad (ELIMINATORIO)** | 0/20            |

**NOTA:** Si la capacidad de pago mensual es <= 0, el estudio se rechaza automaticamente sin importar las demas dimensiones.

### Dimension 3: Coherencia de plazos (riesgo del CLIENTE) — 20 pts

Mide el riesgo de impago: si el credito vence antes de que el cliente cobre a sus propios clientes, no tendra flujo. El plazo de referencia es la **rotacion de cartera** (`accountsReceivableTurnover`).

| Condicion                                       | Resultado   | Puntaje parcial |
| ----------------------------------------------- | ----------- | --------------- |
| `requestedTerm >= accountsReceivableTurnover`     | Coherente   | 20/20           |
| `requestedTerm >= accountsReceivableTurnover*0.7` | Riesgoso    | 10/20           |
| `requestedTerm < accountsReceivableTurnover*0.7`  | Incoherente | 0/20            |

**Importante:** Esta dimension NO empuja el plazo recomendado hacia arriba. El desajuste se reporta como alerta de riesgo, pero el sistema nunca recomienda ampliar el plazo (credito sin intereses). Si `accountsReceivableTurnover <= 0`, se usa `requestedTerm` como referencia.

### Dimension 4: Adecuacion del cupo — 20 pts

```
maxCreditForTerm = monthlyPaymentCapacity * (requestedTerm / 30)
ratio = requestedCreditLine / maxCreditForTerm
```

| Condicion                         | Resultado            | Puntaje parcial |
| --------------------------------- | -------------------- | --------------- |
| ratio <= 1.0 (dentro de rango)    | Adecuado             | 20/20           |
| ratio <= 1.3 (hasta 30% excedido) | Ligeramente excedido | 12/20           |
| ratio > 1.3                       | Excesivo             | 0/20            |

### Dimension 5: Exposicion / Eficiencia del capital (interes del PRESTAMISTA) — 20 pts

Como el credito es comercial **sin intereses**, cada peso prestado y cada dia que tarda en regresar es capital propio inmovilizado sin rendimiento. Esta dimension penaliza creditos que inmovilizan demasiado capital por demasiado tiempo, **aunque el cliente pueda pagarlos**.

Usa el **Ciclo de Conversion de Efectivo (CCC)** del cliente como umbral derivado de datos (no un numero fijo), combinado con la exposicion en meses de caja:

```
supplierDays = MAX(paymentTimeSuppliers, 0)          // negativo -> 0 (dato atipico)
CCC = accountsReceivableTurnover + inventoryTurnover - supplierDays
cicloRef = MAX(CCC, 30)                              // piso de 30 dias
umbralSano = monthlyPaymentCapacity * (cicloRef / 30)
ratioExposicion = requestedCreditLine / umbralSano
```

| Condicion                | Resultado | Puntaje parcial |
| ------------------------ | --------- | --------------- |
| ratioExposicion <= 1.0   | Eficiente | 20/20           |
| ratioExposicion <= 1.5   | Aceptable | 12/20           |
| ratioExposicion > 1.5    | Excesiva  | 0/20            |

El ratio es **adimensional** (exposicion del cliente / su propio ciclo), por lo que funciona igual para cualquier monto: $5M y $500M se juzgan con el mismo criterio relativo, no con un umbral fijo de dias.

---

## 4. Calculo del veredicto final

### viabilityScore (0-100)

```
viabilityScore = sumaDePuntajesParciales (maximo 100)
```

### viabilityStatus

| Condicion                          | Veredicto                     |
| ---------------------------------- | ----------------------------- |
| monthlyPaymentCapacity <= 0        | **`rejected`** (eliminatorio) |
| viabilityScore >= 75               | **`approved`**                |
| viabilityScore >= 40 y < 75        | **`conditional`**             |
| viabilityScore < 40                | **`rejected`**                |

### recommendedTerm (plazo recomendado)

Para un credito comercial **sin intereses**, el plazo recomendado nunca amplia el solicitado; solo puede igualarlo o reducirlo:

- **Nunca mayor al solicitado:** ampliar el plazo inmoviliza capital del prestamista sin compensacion.
- **Puede ser menor:** si el ciclo de caja del cliente (CCC) es mas corto que el plazo pedido, se recomienda menos plazo para recuperar antes el capital.
- **Piso minimo de 30 dias:** un credito comercial no baja de un mes.

```
MIN_RECOMMENDED_TERM = 30
cicloRef = MAX(cashConversionCycle, MIN_RECOMMENDED_TERM)
recommendedTerm = MIN(requestedTerm, cicloRef)
```

### recommendedCreditLine (cupo recomendado)

Nunca supera lo solicitado: si la empresa puede pagar mas, simplemente se aprueba el cupo solicitado.

```
maxAffordableCredit  = monthlyPaymentCapacity * (recommendedTerm / 30)
recommendedCreditLine = min(requestedCreditLine, maxAffordableCredit)
```

### paymentSuggestions (sugerencias de pago)

Las sugerencias de pago (alternativas con cuotas y plazos explicitos) **solo se generan cuando el estudio NO esta rechazado**, es decir, cuando `viabilityStatus` es `approved` o `conditional`, y ademas `monthlyPaymentCapacity > 0`.

- Si `viabilityStatus === 'rejected'` (por capacidad nula o por score < 40): el array `paymentSuggestions` queda **vacio**. Un cliente rechazado no debe recibir alternativas de pago, porque ninguna refleja una solicitud viable; debe rehacer la solicitud.
- **El sistema NUNCA sugiere ampliar el plazo.** La antigua sugerencia `adjusted_term` (estirar el plazo para que quepa el cupo) fue **eliminada**: en un credito sin intereses, un plazo desmedido es mal negocio para el prestamista. Solo quedan dos tipos de sugerencia:

```
adjusted_credit  : mantener el plazo solicitado, reducir el cupo al maximo pagable
                   maxCreditForTerm = monthlyPaymentCapacity * (requestedTerm / 30)

recommended_term : solo si recommendedTerm < requestedTerm (el ciclo del cliente
                   permite recuperar antes); plazo menor con su cupo viable
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

`realTerm = accountsReceivableTurnover` (rotacion de cartera). Si es <= 0, se usa `requestedTerm`.

| Condicion                        | type      | Mensaje                                                                                                                                                                   |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| requestedTerm >= realTerm        | `success` | "El plazo solicitado ({requestedTerm} dias) es coherente con los tiempos de operacion del cliente ({realTerm} dias)."                                                     |
| requestedTerm >= realTerm \* 0.7 | `warning` | "El plazo solicitado ({requestedTerm} dias) es inferior a los tiempos reales de operacion ({realTerm} dias). Riesgo de cobro tardio."                                     |
| requestedTerm < realTerm \* 0.7  | `danger`  | "El plazo solicitado ({requestedTerm} dias) es significativamente inferior a los tiempos reales de operacion ({realTerm} dias). Alto riesgo de incumplimiento en plazos." |
| accountsReceivableTurnover <= 0  | `info`    | "No se pudo calcular la rotacion de cartera. Se usa el plazo solicitado como referencia."                                                                                 |

**Nota:** Esta dimension genera alertas de **riesgo del cliente**, pero **nunca** sugiere ampliar el plazo. Una dimension puede generar multiples alertas.

#### Dimension 4: Cupo (`creditLineAdequacy`)

`maxCreditForRequestedTerm = monthlyPaymentCapacity * (requestedTerm / 30)`

| Condicion    | type      | Mensaje                                                                                                                                 |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ratio <= 1.0 | `success` | "El cupo solicitado esta dentro de la capacidad de pago para {requestedTerm} dias (maximo: ${maxCreditForRequestedTerm})."              |
| ratio <= 1.3 | `warning` | "El cupo solicitado excede en un {exceso}% el cupo maximo para {requestedTerm} dias (${maxCreditForRequestedTerm}). Considere reducirlo." |
| ratio > 1.3  | `danger`  | "El cupo solicitado excede en un {exceso}% el cupo maximo para {requestedTerm} dias (${maxCreditForRequestedTerm}). Se recomienda reducirlo." |

#### Dimension 5: Exposicion / Eficiencia del capital (`capitalExposure`)

`ratioExposicion = requestedCreditLine / (monthlyPaymentCapacity * (MAX(CCC,30) / 30))`

| Condicion              | type      | Mensaje                                                                                                                                                |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ratioExposicion <= 1.0 | `success` | "El credito respeta el ciclo de caja del cliente. El capital prestado rota de forma eficiente."                                                       |
| ratioExposicion <= 1.5 | `warning` | "El credito supera levemente el ciclo de caja del cliente. La exposicion del capital es algo mayor a lo ideal."                                       |
| ratioExposicion > 1.5  | `danger`  | "El credito inmoviliza capital muy por encima del ciclo de caja del cliente. Exposicion excesiva para un credito sin intereses, incluso si el cliente pudiera pagar." |

### Alertas adicionales (cross-dimension, generadas por el backend)

| Condicion                                                | type      | dimension | Mensaje                                                                                                                                       |
| -------------------------------------------------------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| viabilityStatus === 'conditional'                        | `info`    | `general` | "El estudio es aprobable sujeto a las condiciones indicadas. Revise las recomendaciones de plazo y cupo."                                     |
| viabilityStatus === 'rejected' y solo falla por plazos   | `info`    | `general` | "El cliente podria ser viable con un plazo de {recommendedTerm} dias en lugar de {requestedTerm} dias."                                       |
| inventoryTurnover === 0                                  | `info`    | `general` | "No se registra rotacion de inventarios. Verifique si el tipo de negocio del cliente aplica para este indicador."                             |

### JSON completo de ejemplo (caso real)

```json
{
  "dimensions": {
    "financialHealth": {
      "score": 20,
      "maxScore": 20,
      "status": "healthy",
      "label": "Salud Financiera"
    },
    "paymentCapacity": {
      "score": 12,
      "maxScore": 20,
      "status": "tight",
      "ratio": 1.197,
      "marginPercent": 19.7,
      "label": "Capacidad de Pago"
    },
    "termCoherence": {
      "score": 0,
      "maxScore": 20,
      "status": "incoherent",
      "requestedTerm": 60,
      "realTerm": 104,
      "label": "Coherencia de Plazos"
    },
    "creditLineAdequacy": {
      "score": 20,
      "maxScore": 20,
      "status": "adequate",
      "ratio": 0.83,
      "label": "Adecuación del Cupo"
    },
    "capitalExposure": {
      "score": 20,
      "maxScore": 20,
      "status": "efficient",
      "ratio": 0.84,
      "exposureMonths": 0.84,
      "cashConversionCycle": 104,
      "label": "Exposición / Eficiencia del Capital"
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
      "message": "La capacidad de pago mensual ($17,951,266) cubre la cuota mensual estimada ($15,000,000) con un margen ajustado del 19.7%. Se recomienda no incrementar el cupo."
    },
    {
      "type": "danger",
      "dimension": "termCoherence",
      "message": "El plazo solicitado (60 dias) es significativamente inferior a los tiempos reales de operacion (104 dias). Alto riesgo de incumplimiento en plazos."
    },
    {
      "type": "success",
      "dimension": "creditLineAdequacy",
      "message": "El cupo solicitado esta dentro de la capacidad de pago para 60 dias."
    },
    {
      "type": "success",
      "dimension": "capitalExposure",
      "message": "El credito respeta el ciclo de caja del cliente. El capital prestado rota de forma eficiente."
    },
    {
      "type": "info",
      "dimension": "general",
      "message": "El estudio es aprobable sujeto a las condiciones indicadas. Revise las recomendaciones de plazo y cupo."
    }
  ],
  "summary": {
    "totalScore": 72,
    "maxScore": 100,
    "status": "conditional",
    "recommendedTerm": 60,
    "recommendedCreditLine": 15000000,
    "monthlyPaymentCapacity": 17951266,
    "annualPaymentCapacity": 215415193
  }
}
```

> Nota: `recommendedTerm` = 60 (= el solicitado), NO 104. Aunque la rotacion de cartera sea 104 dias, el sistema **no amplia** el plazo. El riesgo de cobro tardio queda reflejado en la alerta `danger` de `termCoherence`, pero la recomendacion respeta el plazo del cliente.

### Pseudocodigo del backend para construir viabilityConditions

```
function buildViabilityConditions(study: CreditStudy): ViabilityConditions {
  const alerts = [];
  const dimensions = {};
  const MIN_TERM = 30;

  // 1. Salud financiera (20 pts)
  const zScore = calculateZScore(study);
  if (zScore > 3.0)      dimensions.financialHealth = { score: 20, maxScore: 20, status: "healthy" };
  else if (zScore > 1.8) dimensions.financialHealth = { score: 10, maxScore: 20, status: "gray_zone" };
  else                   dimensions.financialHealth = { score: 0,  maxScore: 20, status: "critical" };
  // ... push alerta segun caso

  // 2. Capacidad de pago (20 pts) — la cuota integra cupo Y plazo
  const cuotaMensual = study.requestedCreditLine / (study.requestedTerm / 30);
  const paymentRatio = study.monthlyPaymentCapacity / cuotaMensual;
  // ELIMINATORIO si monthlyPaymentCapacity <= 0
  // ... evaluar y generar alertas (20 / 12 / 0)

  // 3. Coherencia de plazos (20 pts) — RIESGO DEL CLIENTE (no empuja el plazo)
  const realTerm = study.accountsReceivableTurnover > 0
    ? study.accountsReceivableTurnover
    : study.requestedTerm;
  // ... evaluar requestedTerm vs realTerm (20 / 10 / 0). Solo genera alertas de riesgo.

  // 4. Adecuacion del cupo (20 pts)
  const maxCreditForTerm = study.monthlyPaymentCapacity * (study.requestedTerm / 30);
  const creditRatio = study.requestedCreditLine / maxCreditForTerm;
  // ... evaluar y generar alertas (20 / 12 / 0)

  // 5. Exposicion / Eficiencia del capital (20 pts) — INTERES DEL PRESTAMISTA
  const supplierDays = Math.max(study.paymentTimeSuppliers, 0);  // negativo -> 0
  const ccc = study.accountsReceivableTurnover + study.inventoryTurnover - supplierDays;
  const cicloRef = Math.max(ccc, MIN_TERM);
  const umbralSano = study.monthlyPaymentCapacity * (cicloRef / 30);
  const exposureRatio = umbralSano > 0 ? study.requestedCreditLine / umbralSano : Infinity;
  if (exposureRatio <= 1.0)      dimensions.capitalExposure = { score: 20, maxScore: 20, status: "efficient" };
  else if (exposureRatio <= 1.5) dimensions.capitalExposure = { score: 12, maxScore: 20, status: "acceptable" };
  else                           dimensions.capitalExposure = { score: 0,  maxScore: 20, status: "excessive" };
  // ... push alerta segun caso

  // 6. Plazo y cupo recomendados — el plazo NUNCA amplia el solicitado
  const recommendedTerm = Math.min(study.requestedTerm, Math.max(ccc, MIN_TERM));
  const maxAffordable = study.monthlyPaymentCapacity * (recommendedTerm / 30);
  const recommendedCreditLine = Math.min(study.requestedCreditLine, maxAffordable);

  // 7. Score y status (ANTES de las sugerencias)
  const totalScore = sum(dimensions.*.score);  // 5 dimensiones x 20 = 100
  let status;
  if (study.monthlyPaymentCapacity <= 0) status = "rejected";   // ELIMINATORIO
  else if (totalScore >= 75) status = "approved";
  else if (totalScore >= 40) status = "conditional";
  else status = "rejected";

  // 8. Sugerencias de pago — SOLO si NO esta rechazado. NUNCA amplia plazo.
  const paymentSuggestions = [];
  if (status !== "rejected" && study.monthlyPaymentCapacity > 0) {
    // adjusted_credit: si el cupo excede la capacidad, reducirlo al maximo pagable
    //                  manteniendo el plazo solicitado.
    if (maxCreditForTerm < study.requestedCreditLine) { /* push adjusted_credit */ }
    // recommended_term: solo si recommendedTerm < requestedTerm (el ciclo permite
    //                   recuperar antes). Plazo menor con su cupo viable.
    if (recommendedTerm < study.requestedTerm) { /* push recommended_term */ }
  }
  dimensions.paymentSuggestions = { label: "Sugerencias de Pago", suggestions: paymentSuggestions };

  // 9. Alertas cross-dimension
  // ... evaluar condiciones generales

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
| **Resumen por dimension** | 5 cards con score parcial (ej: "Capacidad de Pago: 12/20")                | Visual, sin formula             |

### OCULTAR (nunca enviar al frontend)

| Dato                                        | Razon                                  |
| ------------------------------------------- | -------------------------------------- |
| `stabilityFactor` (valor crudo)             | Revela que usas Altman Z-Score         |
| Valores X1-X5                               | Son las razones financieras del modelo |
| Formula del Puntaje Z                       | Propiedad intelectual                  |
| Rotaciones crudas (numeros exactos)         | Solo mostrar interpretacion/alertas    |
| `adjustedEbitda` vs `ebitda` (comparacion)  | Revela que ajustas por estabilidad     |
| Ciclo de Conversion de Efectivo (valor crudo) | Revela el umbral interno de exposicion |
| Umbrales internos (1.8, 3.0, 0.7, 1.0, 1.3, 1.5) | Revelan la logica de decision      |

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

1. **Salud financiera:** 20/20 - Saludable (Z > 3.0)
2. **Capacidad de pago:** 12/20 - Ajustado (ratio = 1.197, margen 19.7%)
3. **Coherencia de plazos:** 0/20 - Incoherente (pide 60d, rotacion cartera 104d) → alerta de riesgo
4. **Adecuacion del cupo:** 20/20 - Dentro de rango (cupo cabe en el plazo solicitado)
5. **Exposicion / Eficiencia:** 20/20 - Eficiente (la exposicion respeta el ciclo de caja)

### Resultado

```
viabilityScore: 72/100
viabilityStatus: "conditional"
recommendedTerm: 60 dias (= solicitado; el sistema NUNCA amplia, aunque la cartera rote a 104d)
recommendedCreditLine: $15,000,000 (= solicitado; viable en 60 dias)
```

**Veredicto: APROBADO CON CONDICIONES**

- El cupo solicitado es viable al plazo pedido.
- Se reporta una alerta de riesgo: el cliente cobra a 104 dias pero pide pagar a 60. El analista decide si asume ese riesgo; el sistema NO amplia el plazo para "acomodarlo".

### Ejemplo: Cliente con rotacion de cartera muy baja (plazo recomendado MENOR)

Caso real: una empresa tipo colegio con cobro casi de contado (rotacion de cartera = 2 dias, sin inventarios). Su ciclo de caja (CCC) es muy corto, asi que el sistema puede recomendar un plazo **menor** al solicitado para recuperar el capital antes — pero acotado al piso de 30 dias.

```
Cupo solicitado: $10,000,000
Plazo solicitado: 60 dias
Capacidad de pago mensual: $98,056,389
Rotacion de cartera: 2 dias  →  CCC ~= 2 dias
```

Aplicando las reglas del nuevo modelo:

```
cicloRef = max(CCC, 30) = max(2, 30) = 30 dias
recommendedTerm = min(requestedTerm, cicloRef) = min(60, 30) = 30 dias  (MENOR al solicitado)
maxAffordableCredit = 98,056,389 * (30/30) = $98,056,389
recommendedCreditLine = min(10,000,000, 98,056,389) = $10,000,000
```

El cupo recomendado coincide con lo solicitado (el cliente puede pagar de sobra), pero el sistema sugiere un **plazo de 30 dias** en lugar de 60: como el cliente cobra de contado, no necesita 60 dias de financiamiento y recuperar el capital antes reduce la exposicion del prestamista. Esto se ofrece como sugerencia `recommended_term`, nunca como obligacion.

---

## 8. Integracion futura con IA (GPT-4o mini)

Agregar un campo adicional al modelo:

```typescript
aiAnalysis?: string;  // Texto generado por IA, se guarda una sola vez al realizar el estudio
```

La IA recibira los datos del estudio + el resultado de viabilidad y generara un analisis narrativo en espanol. Este analisis se persiste para no re-llamar la API cada vez que se consulta el estudio.

**Costo estimado:** ~$0.0006 USD por analisis (~$2.5 COP).

**Modelo de cobro sugerido:** Agregar `maxAIAnalysisPerMonth` al plan de suscripcion, usando la misma logica de limites que ya existe con `maxStudiesPerMonth`.
