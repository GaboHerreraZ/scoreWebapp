# Metodologia de Calificacion - Estudio de Credito

## Objetivo

Este documento describe la metodologia completa que utiliza el sistema para evaluar la viabilidad de otorgar un cupo de credito a una empresa cliente. Esta dirigido a contadores publicos y analistas de credito que necesiten entender como se calculan los indicadores, las dimensiones de evaluacion y el puntaje final.

El sistema analiza los estados financieros del cliente (balance general y estado de resultados) para determinar si tiene la capacidad real de pagar el credito solicitado, en el plazo solicitado, y bajo que condiciones.

**Principio fundamental:** El sistema nunca recomienda un cupo mayor al solicitado por el cliente. Si la empresa puede pagar mas de lo que pide, simplemente se aprueba lo solicitado. Si no puede pagar lo solicitado, se recomienda un monto menor o un plazo mayor.

---

## 1. Datos de Entrada

El analista ingresa al sistema los siguientes datos financieros del cliente:

### Balance General

| Dato | Descripcion |
|------|-------------|
| Efectivo y equivalentes | Caja, bancos, inversiones de corto plazo |
| Cuentas por cobrar (ano 1 y ano 2) | Cartera comercial de dos periodos consecutivos |
| Inventarios (ano 1 y ano 2) | Stock de dos periodos consecutivos |
| Total activo corriente | Suma de activos de corto plazo |
| Activos fijos (propiedad, planta y equipo) | Activos de largo plazo |
| Total activo no corriente | Suma de activos de largo plazo |
| Total activos | Activo corriente + Activo no corriente |
| Obligaciones financieras de corto plazo | Deuda bancaria corriente |
| Proveedores (ano 1 y ano 2) | Cuentas por pagar a proveedores de dos periodos |
| Total pasivo corriente | Suma de pasivos de corto plazo |
| Obligaciones financieras de largo plazo | Deuda bancaria no corriente |
| Total pasivo no corriente | Suma de pasivos de largo plazo |
| Total pasivos | Pasivo corriente + Pasivo no corriente |
| Ganancias acumuladas | Utilidades retenidas |
| Patrimonio | Activo total - Pasivo total |

### Estado de Resultados

| Dato | Descripcion |
|------|-------------|
| Ingresos de actividades ordinarias | Ventas netas del periodo |
| Costo de ventas | Costo directo de los bienes o servicios vendidos |
| Utilidad bruta | Ingresos - Costo de ventas |
| Gastos de administracion | Gastos operativos administrativos |
| Gastos de ventas | Gastos operativos comerciales |
| Depreciacion | Depreciacion de activos fijos |
| Amortizacion | Amortizacion de intangibles |
| Gastos financieros | Intereses pagados sobre obligaciones |
| Impuestos | Provision de impuesto de renta |
| Utilidad neta | Resultado final del periodo |

### Datos del Credito Solicitado

| Dato | Campo | Descripcion |
|------|-------|-------------|
| Cupo solicitado | `requestedCreditLine` | Monto **total** del credito que pide el cliente (en pesos). No es un monto mensual, es el total del credito |
| Plazo solicitado | `requestedTerm` | Numero de dias en los que el cliente pagaria el credito |
| Periodo del estado de resultados | `incomeStatementId` | Anual (12 meses), Semestral (6), Trimestral (3) o Mensual (1) |

---

## 2. Indicadores Calculados

### 2.1 EBITDA

**Formula:**

```
EBITDA = Ingresos ordinarios - Costo de ventas - Gastos de administracion
         - Gastos de ventas + Depreciacion + Amortizacion
```

El EBITDA (Earnings Before Interest, Taxes, Depreciation and Amortization) representa la capacidad operativa de generacion de efectivo de la empresa, antes de compromisos financieros y tributarios.

**Referencia:** Es el indicador estandar utilizado por la banca comercial colombiana y la Superintendencia Financiera para evaluar capacidad de pago empresarial.

### 2.2 Factor de Estabilidad (basado en el Modelo Z-Score de Altman)

El sistema utiliza el modelo Z-Score de Edward Altman (1968) para evaluar la probabilidad de quiebra de la empresa. Este modelo fue desarrollado originalmente para empresas manufactureras y ha sido validado extensamente en la literatura academica financiera.

**Referencia academica:** Altman, E.I. (1968). "Financial Ratios, Discriminant Analysis and the Prediction of Corporate Bankruptcy". *The Journal of Finance*, 23(4), 589-609.

**Componentes del Z-Score:**

| Variable | Formula | Que mide |
|----------|---------|----------|
| X1 | (Activo corriente - Pasivo corriente) / Activo total | Liquidez: capacidad de cubrir obligaciones de corto plazo |
| X2 | Ganancias acumuladas / Activo total | Rentabilidad acumulada: madurez y estabilidad historica |
| X3 | Utilidad operacional / Activo total | Productividad de los activos: eficiencia operativa |
| X4 | Patrimonio / Pasivo total | Apalancamiento: relacion entre recursos propios y deuda |
| X5 | Ingresos ordinarios / Activo total | Rotacion de activos: eficiencia en uso de recursos |

**Puntaje Z:**

```
Z = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + X5
```

Los coeficientes (1.2, 1.4, 3.3, 0.6, 1.0) fueron determinados por Altman mediante analisis discriminante multivariado sobre una muestra de empresas en quiebra vs. empresas sanas.

**Interpretacion del Z-Score:**

| Rango | Zona | Factor de Estabilidad | Interpretacion |
|-------|------|----------------------|----------------|
| Z > 3.0 | Zona segura | 1.0 (100%) | Empresa financieramente saludable. Baja probabilidad de quiebra |
| 1.8 < Z <= 3.0 | Zona gris | 0.66 (66%) | Empresa en observacion. Riesgo moderado |
| Z <= 1.8 | Zona de riesgo | 0.33 (33%) | Alta probabilidad de dificultades financieras |

### 2.3 EBITDA Ajustado

```
EBITDA Ajustado = EBITDA * Factor de Estabilidad
```

El EBITDA se ajusta por el factor de estabilidad para reflejar que una empresa en zona de riesgo tiene menor probabilidad de mantener su nivel de generacion de efectivo. Esto penaliza la capacidad de pago proyectada de empresas con indicadores criticos.

### 2.4 Servicio de Deuda Actual

```
Servicio de Deuda = Obligaciones financieras de corto plazo + Gastos financieros
```

Representa los compromisos financieros actuales que la empresa ya tiene y que restan de su capacidad disponible.

### 2.5 Capacidad de Pago

```
Capacidad de Pago Anual = EBITDA Ajustado - Servicio de Deuda Actual
Capacidad de Pago Mensual = Capacidad de Pago Anual / Meses del periodo
```

Donde "Meses del periodo" depende del estado de resultados ingresado: 12 si es anual, 6 si es semestral, 3 si es trimestral, 1 si es mensual.

La **capacidad de pago mensual** es el monto maximo que la empresa podria destinar cada mes al pago de nuevas obligaciones crediticias, despues de cubrir sus costos operativos y deudas actuales.

### 2.6 Cuota Mensual Estimada

Este es el concepto clave para vincular el cupo total con el plazo:

```
Numero de cuotas = REDONDEAR_ARRIBA(Plazo en dias / 30)
Cuota mensual estimada = Cupo solicitado / Numero de cuotas
```

Ejemplo: Si el cupo es $5,000,000 y el plazo es 60 dias:
- Numero de cuotas = ceil(60/30) = 2 cuotas
- Cuota mensual = $5,000,000 / 2 = $2,500,000

La comparacion central del sistema es: **Capacidad de pago mensual vs. Cuota mensual estimada**.

### 2.7 Indicadores de Rotacion

**Rotacion de cartera (dias) — `accountsReceivableTurnover`:**

```
Rotacion de Cartera = ((CxC ano 1 + CxC ano 2) / 2) / Ingresos ordinarios * 365
```

Indica cuantos dias tarda en promedio la empresa en cobrar a sus clientes. Este es el **indicador clave para definir el plazo recomendado**, ya que refleja el ciclo real de efectivo del negocio.

**Rotacion de inventarios (dias) — `inventoryTurnover`:**

```
Rotacion de Inventarios = ((Inv ano 1 + Inv ano 2) / 2) / Costo de ventas * 365
```

Dias promedio que el inventario permanece en bodega. Aplica para empresas comerciales o manufactureras; es cero para empresas de servicios.

**Tiempo de pago a proveedores (dias) — `paymentTimeSuppliers`:**

```
Rotacion CxP = ((Prov ano 1 + Prov ano 2) / 2) / Egresos operativos
Tiempo de pago a proveedores = Rotacion CxP * 365
Donde Egresos operativos = Costo de ventas + Inventario final + Gastos admin + Gastos ventas - Inventario inicial
```

Dias promedio que la empresa tarda en pagar a sus proveedores. Es un dato **informativo** que muestra el comportamiento de pago de la empresa pero **no define el plazo de referencia** para el credito. Si este valor es mayor que la rotacion de cartera, indica que la empresa paga a proveedores mas lento de lo que cobra a clientes (lo cual puede ser favorable para su flujo de caja).

---

## 3. Sistema de Calificacion: 4 Dimensiones + Sugerencias de Pago

El puntaje de viabilidad se calcula sobre 100 puntos, distribuidos en 4 dimensiones de 25 puntos cada una. Cada dimension evalua un aspecto diferente de la solicitud de credito y retorna:

- **score:** Puntaje obtenido (0, 12, 15 o 25)
- **reason:** Explicacion breve del porque del score, con los valores concretos que lo determinaron

### 3.1 Dimension 1: Salud Financiera (25 puntos)

Evalua la solidez general de la empresa usando el Z-Score de Altman.

| Z-Score | Calificacion | Puntaje | Reason (ejemplo) |
|---------|-------------|---------|------------------|
| Mayor a 3.0 | Saludable | 25/25 | "Los indicadores de liquidez, rentabilidad y apalancamiento situan a la empresa en zona segura." |
| Entre 1.8 y 3.0 | Zona gris | 12/25 | "Los indicadores financieros situan a la empresa en zona de observacion. Se penaliza parcialmente la capacidad proyectada." |
| Menor o igual a 1.8 | Critico | 0/25 | "Los indicadores financieros muestran alta probabilidad de dificultades. Se reduce significativamente la capacidad proyectada." |

### 3.2 Dimension 2: Capacidad de Pago (25 puntos)

Evalua si la empresa puede pagar la cuota mensual estimada del credito.

**Calculo clave:**

```
Cuota mensual estimada = Cupo Solicitado / (Plazo en dias / 30)
Ratio = Capacidad de Pago Mensual / Cuota mensual estimada
```

| Ratio | Calificacion | Puntaje | Reason (ejemplo) |
|-------|-------------|---------|------------------|
| >= 1.2 (margen >= 20%) | Holgado | 25/25 | "La capacidad de pago mensual supera la cuota estimada con un margen del 36.4%. Ratio: 1.36x." |
| >= 1.0 y < 1.2 | Ajustado | 15/25 | "La capacidad cubre la cuota pero con margen ajustado del 8.5%. Ratio: 1.09x. No se recomienda incrementar." |
| < 1.0 | Insuficiente | 0/25 | "La cuota mensual estimada ($2.500.000) supera la capacidad de pago ($2.046.348). Deficit del 18.1%." |
| Capacidad <= 0 | Sin capacidad | 0/25 | "La empresa no genera flujo libre de efectivo despues de cubrir deudas actuales." |

**Nota importante:** Si la capacidad de pago mensual es negativa (el servicio de deuda actual supera el EBITDA ajustado), el estudio se rechaza automaticamente sin importar las demas dimensiones.

### 3.3 Dimension 3: Coherencia de Plazos (25 puntos)

Evalua si el plazo solicitado es realista considerando los tiempos reales de operacion del negocio.

El **plazo de referencia** es la **rotacion de cartera** (`accountsReceivableTurnover`), que indica cuantos dias tarda el cliente en cobrar a sus propios clientes. Si el credito vence antes de que el cliente cobre, hay riesgo de incumplimiento.

El **tiempo de pago a proveedores** (`paymentTimeSuppliers`) se reporta como dato informativo en las alertas (ej: "La empresa paga a proveedores en 170 dias, mas lento de lo que cobra en 67 dias") pero no afecta el puntaje.

| Condicion | Calificacion | Puntaje | Reason (ejemplo) |
|-----------|-------------|---------|------------------|
| Plazo solicitado >= Rotacion de cartera | Coherente | 25/25 | "El plazo solicitado (90d) iguala o supera la rotacion de cartera (67d). El cliente cobra antes de que venza el credito." |
| Plazo solicitado >= 70% de la rotacion | Riesgoso | 12/25 | "El plazo solicitado (60d) es inferior a la rotacion de cartera (67d) pero cubre al menos el 70%. Riesgo moderado." |
| Plazo solicitado < 70% de la rotacion | Incoherente | 0/25 | "El plazo solicitado (30d) es menor al 70% de la rotacion de cartera (67d). El credito vence antes de que el cliente cobre a sus clientes." |

### 3.4 Dimension 4: Adecuacion del Cupo (25 puntos)

Evalua si el monto solicitado es razonable dada la capacidad de pago y el plazo.

**Calculo: Cupo maximo para el plazo solicitado**

```
Cupo Maximo = Capacidad de Pago Mensual * (Plazo solicitado en dias / 30)
Ratio = Cupo Solicitado / Cupo Maximo
```

| Ratio | Calificacion | Puntaje | Reason (ejemplo) |
|-------|-------------|---------|------------------|
| <= 1.0 | Adecuado | 25/25 | "El cupo solicitado ($3.000.000) no supera el maximo pagable en 60 dias ($4.092.696)." |
| <= 1.3 | Ligeramente excedido | 15/25 | "El cupo excede un 22.2% el maximo pagable en 60 dias ($4.092.696). Se recomienda ajustar cupo o ampliar plazo." |
| > 1.3 | Excesivo | 0/25 | "El cupo excede un 45% el maximo pagable en 60 dias ($4.092.696). Es inviable sin reducir cupo o ampliar plazo." |

**Cupo recomendado:**

```
Cupo Maximo Pagable = Capacidad de Pago Mensual * (Plazo recomendado / 30)
Cupo Recomendado = MIN(Cupo Solicitado, Cupo Maximo Pagable)
```

**Regla clave:** El cupo recomendado **nunca supera** lo que el cliente solicito. Si la empresa puede pagar mas, simplemente se aprueba lo solicitado. Si no puede pagar lo solicitado, se recomienda un monto menor con condiciones.

### 3.5 Sugerencias de Pago (informativo, sin puntaje)

Cuando la empresa tiene capacidad de pago positiva, el sistema genera automaticamente hasta 3 alternativas de pago con **cuotas y plazos explicitos**. Cada sugerencia incluye:

| Campo | Descripcion |
|-------|-------------|
| `suggestedTerm` | Plazo en dias |
| `suggestedCredit` | Cupo total |
| `numberOfPayments` | Numero de cuotas (= ceil(dias / 30)) |
| `paymentAmount` | Valor de cada cuota (= cupo / numero de cuotas) |
| `description` | Texto legible que describe la alternativa |

**Sugerencia 1: Mismo cupo, plazo ajustado (`adjusted_term`)**

Se genera solo si el cupo solicitado no cabe en el plazo pedido. Calcula en cuantos dias SI podria pagarlo:

```
Meses necesarios = Cupo Solicitado / Capacidad de Pago Mensual
Dias necesarios = REDONDEAR_ARRIBA(Meses necesarios * 30)
Numero de cuotas = REDONDEAR_ARRIBA(Dias necesarios / 30)
Valor cuota = Cupo Solicitado / Numero de cuotas
```

Ejemplo: "$5.000.000 en 74 dias: 3 cuotas de $1.666.667"

**Sugerencia 2: Mismo plazo, cupo ajustado (`adjusted_credit`)**

Se genera solo si el cupo solicitado excede la capacidad para el plazo pedido. Calcula el cupo maximo viable:

```
Cupo maximo = Capacidad de Pago Mensual * (Plazo solicitado / 30)
Numero de cuotas = REDONDEAR_ARRIBA(Plazo solicitado / 30)
Valor cuota = Cupo maximo / Numero de cuotas
```

Ejemplo: "Plazo de 60 dias, cupo de $4.092.696: 2 cuotas de $2.046.348"

**Sugerencia 3: Con plazo recomendado (`recommended_term`)**

Usa el plazo recomendado (rotacion de cartera ajustada por las cotas: piso de 30 dias y no menor al plazo solicitado). El cupo nunca supera lo solicitado:

```
Plazo recomendado = max(rotacion de cartera, plazo solicitado, 30)
Cupo maximo con plazo recomendado = Capacidad de Pago Mensual * (Plazo recomendado / 30)
Cupo sugerido = MIN(Cupo Solicitado, Cupo maximo con plazo recomendado)
Numero de cuotas = REDONDEAR_ARRIBA(Plazo recomendado / 30)
Valor cuota = Cupo sugerido / Numero de cuotas
```

Ejemplo: "Con plazo de 67 dias: cupo de $4.570.177 en 3 cuotas de $1.523.392"

---

## 4. Puntaje Final y Veredicto

### Puntaje Total (0-100)

```
Puntaje = Salud Financiera + Capacidad de Pago + Coherencia de Plazos + Adecuacion del Cupo
```

### Veredicto

| Condicion | Resultado |
|-----------|-----------|
| Capacidad de pago mensual <= 0 | **Rechazado** (eliminatorio, sin importar el score) |
| Puntaje >= 75 | **Aprobado** |
| Puntaje >= 40 y < 75 | **Condicionado** (aprobable con ajustes en plazo o cupo) |
| Puntaje < 40 | **Rechazado** |

### Recomendaciones del Sistema

El sistema genera recomendaciones especificas:

- **Plazo recomendado:** Se basa en la rotacion de cartera (dias que tarda en cobrar a clientes), pero con dos cotas:
  - **Piso minimo de 30 dias:** un credito comercial no debe tener plazo menor a un mes, aunque el cliente cobre casi de contado (ej: colegios, retail con cobro inmediato).
  - **Respeta el plazo solicitado:** si el cliente pide un plazo mayor y el cupo es viable en ese plazo, no se reduce. Asi se evita que una rotacion de cartera muy rapida fuerce un plazo corto que reduzca artificialmente el cupo recomendado.

  Formula: `recommendedTerm = max(accountsReceivableTurnover, requestedTerm, 30)`

- **Cupo recomendado:** El menor entre lo solicitado y lo que puede pagar en el plazo recomendado. Nunca supera lo solicitado
- **Cupo maximo para plazo solicitado:** Monto maximo pagable si se mantiene el plazo solicitado
- **Sugerencias de pago:** Hasta 3 alternativas con cuotas y plazos explicitos
- **Alertas:** Mensajes descriptivos por dimension indicando riesgos, observaciones y sugerencias. Incluye informacion sobre el tiempo de pago a proveedores cuando es relevante

---

## 5. Ejemplos Practicos

### Ejemplo 1: Credito aprobado ($3,000,000 a 60 dias)

**Datos del cliente:**

- Cupo total solicitado: $3,000,000
- Plazo solicitado: 60 dias (2 cuotas)
- Cuota mensual estimada: $3,000,000 / 2 = $1,500,000
- Capacidad de pago mensual: $2,046,348
- Rotacion de cartera: 67 dias
- Tiempo de pago a proveedores: 170 dias (informativo)

**Evaluacion por dimension:**

| Dimension | Puntaje | Reason |
|-----------|---------|--------|
| Salud Financiera | 25/25 | Z-Score > 3.0 — zona segura |
| Capacidad de Pago | 25/25 | Ratio = $2,046,348 / $1,500,000 = 1.36x. Margen del 36.4% |
| Coherencia de Plazos | 12/25 | Plazo 60d < rotacion 67d, pero cubre el 89% (>= 70%) |
| Adecuacion del Cupo | 25/25 | $3M < maximo pagable en 60d ($4,092,696). Ratio 0.73 |
| **Total** | **87/100** | |

**Veredicto: APROBADO**

- Cupo recomendado: $3,000,000 (el sistema no recomienda mas de lo solicitado)
- Plazo recomendado: 67 dias
- No se generan sugerencias de cupo ajustado porque el cupo ya es viable

**Sugerencia generada:**
- Con plazo de 67 dias (rotacion de cartera): cupo de $3,000,000 en 3 cuotas de $1,000,000

### Ejemplo 2: Credito condicionado ($5,000,000 a 60 dias)

**Datos del cliente (mismos estados financieros):**

- Cupo total solicitado: $5,000,000
- Plazo solicitado: 60 dias (2 cuotas)
- Cuota mensual estimada: $5,000,000 / 2 = $2,500,000
- Capacidad de pago mensual: $2,046,348
- Rotacion de cartera: 67 dias
- Tiempo de pago a proveedores: 170 dias (informativo)

**Evaluacion por dimension:**

| Dimension | Puntaje | Reason |
|-----------|---------|--------|
| Salud Financiera | 25/25 | Z-Score > 3.0 — zona segura |
| Capacidad de Pago | 0/25 | Cuota $2,500,000 > capacidad $2,046,348. Deficit 18.1% |
| Coherencia de Plazos | 12/25 | Plazo 60d < rotacion 67d, pero cubre el 89% (>= 70%) |
| Adecuacion del Cupo | 15/25 | $5M excede 22.2% el maximo para 60d ($4,092,696) |
| **Total** | **52/100** | |

**Veredicto: CONDICIONADO**

- Cupo recomendado: $4,570,177 (min($5M, capacidad * 67d/30) — menor que lo solicitado)
- Plazo recomendado: 67 dias

**Sugerencias de pago generadas:**

| Alternativa | Plazo | Cupo | Cuotas | Valor cuota |
|---|---|---|---|---|
| Mantener cupo, ampliar plazo | 74 dias | $5,000,000 | 3 cuotas | $1,666,667 |
| Mantener plazo, reducir cupo | 60 dias | $4,092,696 | 2 cuotas | $2,046,348 |
| Con plazo recomendado (rotacion) | 67 dias | $4,570,177 | 3 cuotas | $1,523,392 |

El analista puede usar estas alternativas para negociar con el cliente sin rechazar la solicitud de plano.

---

## 6. Estructura de la Respuesta (JSON)

Cada dimension retorna los siguientes campos:

```json
{
  "score": 25,
  "maxScore": 25,
  "status": "healthy",
  "label": "Salud Financiera",
  "reason": "Los indicadores de liquidez, rentabilidad y apalancamiento situan a la empresa en zona segura."
}
```

Las sugerencias de pago retornan:

```json
{
  "type": "adjusted_term",
  "suggestedTerm": 74,
  "suggestedCredit": 5000000,
  "numberOfPayments": 3,
  "paymentAmount": 1666667,
  "description": "Mantener cupo de $5.000.000 ampliando a 74 dias: 3 cuotas de $1.666.667."
}
```

---

## 7. Fundamentacion Teorica

### Modelo Z-Score de Altman

El Z-Score es un modelo de prediccion de quiebra desarrollado por Edward I. Altman en 1968 en la Universidad de Nueva York. Utiliza analisis discriminante multiple sobre 5 razones financieras para estimar la probabilidad de insolvencia de una empresa.

**Publicacion original:** Altman, E.I. (1968). "Financial Ratios, Discriminant Analysis and the Prediction of Corporate Bankruptcy". *The Journal of Finance*, Vol. 23, No. 4, pp. 589-609.

El modelo ha sido ampliamente validado y es utilizado como referencia por:
- Superintendencia Financiera de Colombia para evaluacion de riesgo crediticio
- Banca comercial colombiana en sus modelos internos de scoring
- Normas Internacionales de Informacion Financiera (NIIF) como indicador de empresa en funcionamiento

### EBITDA como medida de capacidad de pago

El EBITDA es el indicador estandar utilizado por la industria financiera para evaluar la capacidad de generacion de flujo de efectivo operativo. Es preferido sobre la utilidad neta porque:
- Excluye partidas no monetarias (depreciacion, amortizacion)
- Excluye decisiones de financiamiento (gastos financieros)
- Excluye impuestos (que varian por regimen)
- Refleja la capacidad real de generar caja desde la operacion

**Referencia:** Circular Externa 029 de 2014 de la Superintendencia Financiera de Colombia, que establece el EBITDA como indicador clave en la evaluacion de capacidad de pago empresarial.

### Rotacion de Cartera como base para plazos

La rotacion de cartera se usa como referencia principal para el plazo recomendado porque:
- Refleja cuantos dias tarda el cliente en cobrar a sus propios clientes
- Si el credito vence antes de que el cliente cobre, no tendra flujo para pagar
- Es un indicador objetivo basado en datos reales del negocio

El tiempo de pago a proveedores es informativo pero no define el plazo porque:
- Indica la politica de pago del cliente, no su capacidad de cobro
- Puede estar distorsionado por acuerdos comerciales especificos
- No refleja directamente cuando el cliente recibe efectivo

**Cotas aplicadas al plazo recomendado:**

La rotacion de cartera por si sola puede dar plazos no comerciales (ej: 2 dias en colegios, retail). Por eso el plazo recomendado se acota:

- **Piso minimo de 30 dias:** un credito comercial debe ser al menos mensual.
- **No menor al plazo solicitado:** si el cliente pide mas plazo y el cupo es viable, se respeta su solicitud. De lo contrario, una rotacion de cartera rapida (signo financiero positivo) acabaria reduciendo el cupo recomendado por debajo de lo solicitado, lo cual no tiene sentido.

**Referencia:** Gitman, L.J. & Zutter, C.J. "Principles of Managerial Finance" (Pearson), capitulos sobre administracion del capital de trabajo y ciclo de conversion de efectivo.

---

## 8. Limitaciones del Modelo

1. **Datos historicos:** El modelo se basa en estados financieros pasados, no proyecciones. La situacion del cliente puede cambiar.
2. **Calidad de la informacion:** Los resultados son tan confiables como los estados financieros ingresados. Se recomienda usar estados financieros auditados o certificados por contador.
3. **Z-Score de Altman:** Fue disenado para empresas manufactureras cotizadas en bolsa. Para PYMES colombianas, los umbrales pueden no ser exactos, pero la direccion del indicador sigue siendo valida.
4. **Sector economico:** El modelo no diferencia por sector. Empresas de servicios con cero inventario o empresas con ciclos estacionales pueden requerir analisis adicional.
5. **Un solo periodo:** El analisis se basa en un periodo contable. Se recomienda revisar tendencias de multiples periodos cuando sea posible.
6. **Cuotas uniformes:** Las sugerencias asumen cuotas de igual monto. En la practica, la empresa podria preferir esquemas con cuotas variables o un solo pago al vencimiento.
