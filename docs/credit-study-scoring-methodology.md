# Metodologia de Calificacion - Estudio de Credito

## Objetivo

Este documento describe la metodologia completa que utiliza el sistema para evaluar la viabilidad de otorgar un cupo de credito a una empresa cliente. Esta dirigido a contadores publicos y analistas de credito que necesiten entender como se calculan los indicadores, las dimensiones de evaluacion y el puntaje final.

El sistema analiza los estados financieros del cliente (balance general y estado de resultados) para determinar si tiene la capacidad real de pagar el credito solicitado, en el plazo solicitado, y bajo que condiciones.

**Principios fundamentales:**

1. **El sistema nunca recomienda un cupo mayor al solicitado.** Si la empresa puede pagar mas de lo que pide, simplemente se aprueba lo solicitado. Si no puede pagar lo solicitado, se recomienda un monto menor.

2. **El sistema nunca recomienda un plazo mayor al solicitado.** El credito que otorga la empresa es **comercial sin intereses**: cada dia adicional de plazo es capital propio inmovilizado, sin rendimiento que lo compense, y mayor riesgo. Estirar el plazo para que "quepa" un cupo grande es financieramente perjudicial para el prestamista y puede llevarlo a la quiebra por falta de rotacion de su capital. Por eso la unica palanca de ajuste cuando un cupo no cabe es **reducir el cupo**, nunca ampliar el plazo. El sistema si puede recomendar un plazo **menor** al solicitado cuando el ciclo de caja del cliente lo permite (recuperar antes es mejor para la empresa).

3. **El plazo se evalua desde dos perspectivas distintas:** la del *cliente* (¿alcanza a cobrar antes de que venza el credito? — riesgo de impago) y la del *prestamista* (¿cuanto capital queda inmovilizado y por cuanto tiempo? — eficiencia y exposicion). Ambas perspectivas tienen su propia dimension de calificacion.

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

**Ciclo de Conversion de Efectivo (dias) — `cashConversionCycle` (CCC):**

```
CCC = Rotacion de Cartera + Rotacion de Inventarios - Tiempo de pago a Proveedores
```

El CCC mide cuantos dias tarda la empresa en convertir su operacion en efectivo: desde que compra/produce, vende, cobra a sus clientes y paga a sus proveedores. Es el **indicador estandar de la administracion del capital de trabajo** (Gitman & Zutter) y representa el **plazo natural del negocio** del cliente.

Su importancia para el modelo: el CCC se deriva enteramente de los datos del propio estudio, por lo que define un **umbral de plazo "sano" especifico para cada cliente**, sin recurrir a un numero fijo arbitrario. Un credito comercial sin intereses no deberia financiar al cliente mas alla de su propio ciclo de caja, porque eso inmoviliza capital del prestamista mas tiempo del que la operacion del cliente realmente necesita.

- CCC bajo (ej: colegio que cobra de contado y casi no tiene inventario) → el cliente necesita poco financiamiento; plazos cortos son adecuados.
- CCC alto (ej: empresa que produce, almacena y cobra a 90 dias) → el cliente requiere mas dias de financiamiento por la naturaleza de su operacion.

**Manejo de datos atipicos:**

- Si `paymentTimeSuppliers` resulta **negativo** (anomalia de la formula de rotacion de proveedores), se trata como **0** en el calculo del CCC, para no inflar artificialmente el ciclo ni el umbral de exposicion. Un proveedor "negativo" no debe extender el ciclo de caja.
- Si el CCC final resulta <= 0 (la empresa se autofinancia con sus proveedores — situacion favorable), se acota al **piso minimo de 30 dias** como ciclo de referencia.

---

## 3. Sistema de Calificacion: 5 Dimensiones + Sugerencias de Pago

El puntaje de viabilidad se calcula sobre 100 puntos, distribuidos en **5 dimensiones de 20 puntos cada una**. Cuatro de ellas evaluan al **cliente** (¿puede pagar? ¿es solvente? ¿el plazo es realista? ¿el monto es razonable?) y una quinta evalua al **prestamista** (¿cuanto capital propio queda inmovilizado y por cuanto tiempo?). Cada dimension retorna:

- **score:** Puntaje obtenido (0, 10, 12 o 20 segun la dimension)
- **reason:** Explicacion breve del porque del score, con los valores concretos que lo determinaron

> **Nota de version:** Hasta la version anterior el modelo tenia 4 dimensiones de 25 puntos. Se agrego la 5ª dimension (Exposicion / Eficiencia del Capital) para incorporar la perspectiva del prestamista, y se redistribuyeron los 100 puntos a 5 × 20. Los cortes parciales se reescalaron proporcionalmente (25→20, 12→10 manteniendo ~50%, 15→12 manteniendo ~60%). El veredicto final (umbrales 75/40 sobre 100) no cambia.

### 3.1 Dimension 1: Salud Financiera (20 puntos)

Evalua la solidez general de la empresa usando el Z-Score de Altman.

| Z-Score | Calificacion | Puntaje | Reason (ejemplo) |
|---------|-------------|---------|------------------|
| Mayor a 3.0 | Saludable | 20/20 | "Los indicadores de liquidez, rentabilidad y apalancamiento situan a la empresa en zona segura." |
| Entre 1.8 y 3.0 | Zona gris | 10/20 | "Los indicadores financieros situan a la empresa en zona de observacion. Se penaliza parcialmente la capacidad proyectada." |
| Menor o igual a 1.8 | Critico | 0/20 | "Los indicadores financieros muestran alta probabilidad de dificultades. Se reduce significativamente la capacidad proyectada." |

### 3.2 Dimension 2: Capacidad de Pago (20 puntos)

Evalua si la empresa puede pagar la cuota mensual estimada del credito.

**Calculo clave:**

```
Cuota mensual estimada = Cupo Solicitado / (Plazo en dias / 30)
Ratio = Capacidad de Pago Mensual / Cuota mensual estimada
```

| Ratio | Calificacion | Puntaje | Reason (ejemplo) |
|-------|-------------|---------|------------------|
| >= 1.2 (margen >= 20%) | Holgado | 20/20 | "La capacidad de pago mensual supera la cuota estimada con un margen del 36.4%. Ratio: 1.36x." |
| >= 1.0 y < 1.2 | Ajustado | 12/20 | "La capacidad cubre la cuota pero con margen ajustado del 8.5%. Ratio: 1.09x. No se recomienda incrementar." |
| < 1.0 | Insuficiente | 0/20 | "La cuota mensual estimada ($2.500.000) supera la capacidad de pago ($2.046.348). Deficit del 18.1%." |
| Capacidad <= 0 | Sin capacidad | 0/20 | "La empresa no genera flujo libre de efectivo despues de cubrir deudas actuales." |

**Nota importante:** Si la capacidad de pago mensual es negativa (el servicio de deuda actual supera el EBITDA ajustado), el estudio se rechaza automaticamente sin importar las demas dimensiones.

### 3.3 Dimension 3: Coherencia de Plazos (20 puntos) — perspectiva del CLIENTE

Evalua si el plazo solicitado es realista considerando los tiempos reales de operacion del negocio, desde la optica del **riesgo de impago del cliente**: si el credito vence antes de que el cliente cobre a sus propios clientes, no tendra flujo para pagar.

El **plazo de referencia** es la **rotacion de cartera** (`accountsReceivableTurnover`), que indica cuantos dias tarda el cliente en cobrar. El **tiempo de pago a proveedores** (`paymentTimeSuppliers`) se reporta como dato informativo en las alertas pero no afecta el puntaje.

| Condicion | Calificacion | Puntaje | Reason (ejemplo) |
|-----------|-------------|---------|------------------|
| Plazo solicitado >= Rotacion de cartera | Coherente | 20/20 | "El plazo solicitado (90d) iguala o supera la rotacion de cartera (67d). El cliente cobra antes de que venza el credito." |
| Plazo solicitado >= 70% de la rotacion | Riesgoso | 10/20 | "El plazo solicitado (60d) es inferior a la rotacion de cartera (67d) pero cubre al menos el 70%. Riesgo moderado." |
| Plazo solicitado < 70% de la rotacion | Incoherente | 0/20 | "El plazo solicitado (30d) es menor al 70% de la rotacion de cartera (67d). El credito vence antes de que el cliente cobre a sus clientes." |

> **Importante:** Esta dimension mide *riesgo del cliente*, NO empuja el plazo hacia arriba. Aunque la rotacion de cartera sea mayor al plazo solicitado, el sistema **no recomienda ampliar el plazo** (ver principio fundamental 2). El desajuste se reporta como alerta de riesgo para que el analista lo considere, pero la recomendacion de plazo nunca supera lo solicitado.

### 3.4 Dimension 4: Adecuacion del Cupo (20 puntos)

Evalua si el monto solicitado es razonable dada la capacidad de pago y el plazo.

**Calculo: Cupo maximo para el plazo solicitado**

```
Cupo Maximo = Capacidad de Pago Mensual * (Plazo solicitado en dias / 30)
Ratio = Cupo Solicitado / Cupo Maximo
```

| Ratio | Calificacion | Puntaje | Reason (ejemplo) |
|-------|-------------|---------|------------------|
| <= 1.0 | Adecuado | 20/20 | "El cupo solicitado ($3.000.000) no supera el maximo pagable en 60 dias ($4.092.696)." |
| <= 1.3 | Ligeramente excedido | 12/20 | "El cupo excede un 22.2% el maximo pagable en 60 dias ($4.092.696). Se recomienda reducir el cupo." |
| > 1.3 | Excesivo | 0/20 | "El cupo excede un 45% el maximo pagable en 60 dias ($4.092.696). Es inviable sin reducir el cupo." |

**Cupo recomendado:**

```
Cupo Maximo Pagable = Capacidad de Pago Mensual * (Plazo recomendado / 30)
Cupo Recomendado = MIN(Cupo Solicitado, Cupo Maximo Pagable)
```

**Regla clave:** El cupo recomendado **nunca supera** lo que el cliente solicito. Si la empresa puede pagar mas, se aprueba lo solicitado. Si no puede pagar lo solicitado, se recomienda un monto menor — **nunca se amplia el plazo para compensar**.

### 3.5 Dimension 5: Exposicion / Eficiencia del Capital (20 puntos) — perspectiva del PRESTAMISTA

Esta dimension es la que incorpora el interes de la **empresa que presta**, no del cliente. Como el credito es **comercial sin intereses**, cada peso prestado y cada dia que tarda en regresar es capital propio inmovilizado que no genera rendimiento. Un credito puede ser perfectamente pagable por el cliente (dimensiones 1-4 altas) y aun asi ser **mal negocio para el prestamista** si inmoviliza demasiado capital por demasiado tiempo.

**Tecnica empleada (derivada de datos, sin umbrales arbitrarios):** se combina el **Ciclo de Conversion de Efectivo (CCC)** del cliente con la cobertura de capacidad (en linea con el indicador DSCR de la banca). El umbral de "plazo sano" no es un numero fijo: es el **propio ciclo de caja del cliente**, calculado desde sus estados financieros. Esto resuelve el problema de que "50 dias para $5.000.000" y "50 dias para $500.000.000" no son comparables: el modelo no juzga el plazo en abstracto, sino la **exposicion relativa**.

**Indicadores:**

```
Exposicion (meses de caja)  = Cupo Solicitado / Capacidad de Pago Mensual
                              (cuantos meses de toda la generacion de caja del cliente
                               equivale el prestamo; adimensional respecto al monto)

Rotacion del capital (modulador) = penaliza plazos largos SOLO cuando la exposicion es alta

Umbral sano del cliente     = Capacidad de Pago Mensual * (CCC / 30)
                              (lo maximo que tiene sentido prestar sin intereses,
                               acotado al ciclo de caja propio del cliente)
```

**Logica de puntaje (la exposicion se compara contra el ciclo del cliente, no contra un fijo):**

```
ratioExposicion = Cupo Solicitado / Umbral sano del cliente
                = (Cupo Solicitado / Capacidad Mensual) / (CCC / 30)
```

| Condicion | Calificacion | Puntaje | Interpretacion |
|-----------|-------------|---------|----------------|
| ratioExposicion <= 1.0 | Eficiente | 20/20 | El cupo y plazo respetan el ciclo de caja del cliente. Capital bien rotado. |
| ratioExposicion <= 1.5 | Aceptable | 12/20 | La exposicion supera levemente el ciclo natural del cliente. Tolerable. |
| ratioExposicion > 1.5 | Excesiva | 0/20 | El prestamo inmoviliza capital muy por encima del ciclo del cliente. Mal negocio para el prestamista aunque el cliente pueda pagar. |

> Los cortes 1.0 / 1.5 se aplican sobre un **ratio adimensional** (exposicion del cliente / su propio ciclo), no sobre dias ni montos absolutos, por lo que funcionan igual para cualquier tamano de cliente. Si el CCC es <= 0 (cliente que se autofinancia con proveedores), se usa el piso minimo de plazo de 30 dias como ciclo de referencia.

### 3.5 Sugerencias de Pago (informativo, sin puntaje)

**Condicion previa:** Las sugerencias de pago solo se generan cuando el estudio **no esta rechazado** (es decir, el veredicto es `approved` o `conditional`) **y** la capacidad de pago mensual es positiva.

Si el estudio queda **rechazado** —ya sea porque la capacidad de pago es nula/negativa, o porque el puntaje total es inferior a 40— **no se genera ninguna sugerencia de pago**. La logica es que un cliente rechazado no esta en condiciones de asumir el credito bajo ninguna de las alternativas, por lo que ofrecer cuotas seria enganoso. En estos casos la solicitud debe rehacerse con otros parametros (menor cupo, mejores estados financieros, etc.). El array `paymentSuggestions` queda vacio.

Cuando el estudio es viable, el sistema genera automaticamente hasta 3 alternativas de pago con **cuotas y plazos explicitos**. Cada sugerencia incluye:

| Campo | Descripcion |
|-------|-------------|
| `suggestedTerm` | Plazo en dias |
| `suggestedCredit` | Cupo total |
| `numberOfPayments` | Numero de cuotas (= ceil(dias / 30)) |
| `paymentAmount` | Valor de cada cuota (= cupo / numero de cuotas) |
| `description` | Texto legible que describe la alternativa |

**Regla general (cambio de version):** Como el credito es comercial sin intereses, **el sistema ya no sugiere ampliar el plazo**. La sugerencia `adjusted_term` (estirar el plazo para que quepa un cupo grande) fue **eliminada**, porque un plazo desmedido inmoviliza capital del prestamista sin compensacion y es mal negocio. La unica palanca cuando el cupo no cabe es **reducir el cupo**. El sistema si puede sugerir un plazo **menor** al solicitado cuando el ciclo de caja del cliente lo permite.

**Sugerencia 1: Mismo plazo, cupo ajustado (`adjusted_credit`)**

Se genera solo si el cupo solicitado excede la capacidad para el plazo pedido. Calcula el cupo maximo viable manteniendo el plazo que el cliente pidio:

```
Cupo maximo = Capacidad de Pago Mensual * (Plazo solicitado / 30)
Numero de cuotas = REDONDEAR_ARRIBA(Plazo solicitado / 30)
Valor cuota = Cupo maximo / Numero de cuotas
```

Ejemplo: "Plazo de 60 dias, cupo de $4.092.696: 2 cuotas de $2.046.348"

**Sugerencia 2: Plazo recomendado MENOR (`recommended_term`)**

Se genera solo si el plazo recomendado es **menor** al solicitado (es decir, el cliente cobra/opera mas rapido de lo que pidio, y conviene recuperar el capital antes). El plazo recomendado se basa en el ciclo de caja del cliente, acotado a un piso de 30 dias y **nunca mayor** al solicitado:

```
Plazo recomendado = MIN(Plazo solicitado, MAX(Ciclo de Conversion de Efectivo, 30))
Cupo maximo con plazo recomendado = Capacidad de Pago Mensual * (Plazo recomendado / 30)
Cupo sugerido = MIN(Cupo Solicitado, Cupo maximo con plazo recomendado)
Numero de cuotas = REDONDEAR_ARRIBA(Plazo recomendado / 30)
Valor cuota = Cupo sugerido / Numero de cuotas
```

Ejemplo: cliente pide 90 dias pero su CCC es de 35 dias → "Con plazo de 35 dias (ciclo de caja del cliente): cupo de $X en 2 cuotas de $Y". Recuperar antes reduce la exposicion del prestamista.

Si el plazo recomendado coincide con el solicitado (el cliente ya pidio un plazo ajustado a su ciclo o menor), esta sugerencia no se genera.

---

## 4. Puntaje Final y Veredicto

### Puntaje Total (0-100)

```
Puntaje = Salud Financiera + Capacidad de Pago + Coherencia de Plazos
        + Adecuacion del Cupo + Exposicion/Eficiencia del Capital
        (5 dimensiones x 20 puntos)
```

### Veredicto

| Condicion | Resultado |
|-----------|-----------|
| Capacidad de pago mensual <= 0 | **Rechazado** (eliminatorio, sin importar el score) |
| Puntaje >= 75 | **Aprobado** |
| Puntaje >= 40 y < 75 | **Condicionado** (aprobable con ajuste de cupo) |
| Puntaje < 40 | **Rechazado** |

### Recomendaciones del Sistema

El sistema genera recomendaciones especificas:

- **Plazo recomendado:** Se basa en el ciclo de caja del cliente, pero con dos reglas estrictas derivadas del principio "credito comercial sin intereses":
  - **Nunca mayor al solicitado:** el sistema jamas recomienda ampliar el plazo. Estirar el plazo inmoviliza capital del prestamista sin compensacion.
  - **Puede ser menor al solicitado:** si el ciclo de caja del cliente (CCC) es mas corto que el plazo pedido, se recomienda un plazo menor para recuperar el capital antes. Acotado a un **piso minimo de 30 dias** (un credito comercial no baja de un mes, aunque el cliente cobre de contado).

  Formula: `recommendedTerm = MIN(requestedTerm, MAX(cashConversionCycle, 30))`

- **Cupo recomendado:** El menor entre lo solicitado y lo que puede pagar en el plazo recomendado. Nunca supera lo solicitado.
- **Cupo maximo para plazo solicitado:** Monto maximo pagable si se mantiene el plazo solicitado.
- **Sugerencias de pago:** Hasta 2 alternativas con cuotas y plazos explicitos (reducir cupo a tu plazo; o plazo menor si el ciclo lo permite). **Solo se generan si el estudio NO esta rechazado** (veredicto `approved` o `conditional`). Un estudio rechazado no recibe sugerencias. **El sistema nunca sugiere ampliar el plazo.**
- **Alertas:** Mensajes descriptivos por dimension indicando riesgos, observaciones y sugerencias. Incluye informacion sobre el tiempo de pago a proveedores y el ciclo de caja cuando es relevante.

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

**Datos de ciclo (para la Dimension 5):**

- Rotacion de inventarios: 0 dias (empresa de servicios)
- Tiempo de pago a proveedores: 170 dias
- Ciclo de Conversion de Efectivo (CCC) = 67 + 0 - 170 = **-103 dias** → al ser negativo se usa el piso de 30 dias como ciclo de referencia.
- Umbral sano = $2,046,348 * (30/30) = $2,046,348... pero como el plazo solicitado (60d) supera el ciclo, el umbral se evalua sobre el plazo recomendado. Exposicion = cupo / capacidad mensual = $3M / $2,046,348 = 1.47 meses de caja.

**Evaluacion por dimension:**

| Dimension | Puntaje | Reason |
|-----------|---------|--------|
| Salud Financiera | 20/20 | Z-Score > 3.0 — zona segura |
| Capacidad de Pago | 20/20 | Ratio = $2,046,348 / $1,500,000 = 1.36x. Margen del 36.4% |
| Coherencia de Plazos | 10/20 | Plazo 60d < rotacion 67d, pero cubre el 89% (>= 70%) |
| Adecuacion del Cupo | 20/20 | $3M < maximo pagable en 60d ($4,092,696). Ratio 0.73 |
| Exposicion / Eficiencia | 20/20 | Exposicion 1.47 meses de caja, dentro del ciclo. Capital bien rotado. |
| **Total** | **90/100** | |

**Veredicto: APROBADO**

- Cupo recomendado: $3,000,000 (el sistema no recomienda mas de lo solicitado)
- Plazo recomendado: 60 dias (= MIN(60, MAX(CCC, 30)) — no se amplia)
- No se generan sugerencias porque el cupo ya es viable y el plazo ya es ajustado.

### Ejemplo 2: Credito condicionado ($5,000,000 a 60 dias)

**Datos del cliente (mismos estados financieros):**

- Cupo total solicitado: $5,000,000
- Plazo solicitado: 60 dias (2 cuotas)
- Cuota mensual estimada: $5,000,000 / 2 = $2,500,000
- Capacidad de pago mensual: $2,046,348
- Rotacion de cartera: 67 dias
- Exposicion: $5M / $2,046,348 = 2.44 meses de caja

**Evaluacion por dimension:**

| Dimension | Puntaje | Reason |
|-----------|---------|--------|
| Salud Financiera | 20/20 | Z-Score > 3.0 — zona segura |
| Capacidad de Pago | 0/20 | Cuota $2,500,000 > capacidad $2,046,348. Deficit 18.1% |
| Coherencia de Plazos | 10/20 | Plazo 60d < rotacion 67d, pero cubre el 89% (>= 70%) |
| Adecuacion del Cupo | 12/20 | $5M excede 22.2% el maximo para 60d ($4,092,696) |
| Exposicion / Eficiencia | 12/20 | Exposicion 2.44 meses de caja, supera levemente el ciclo. Aceptable. |
| **Total** | **54/100** | |

**Veredicto: CONDICIONADO**

- Cupo recomendado: $4,092,696 (min($5M, capacidad * 60d/30) — al plazo solicitado, menor que lo pedido)
- Plazo recomendado: 60 dias (NO se amplia; igual al solicitado porque el CCC no lo reduce por debajo)

**Sugerencias de pago generadas (el sistema NUNCA amplia plazo):**

| Alternativa | Plazo | Cupo | Cuotas | Valor cuota |
|---|---|---|---|---|
| Mantener plazo, reducir cupo (`adjusted_credit`) | 60 dias | $4,092,696 | 2 cuotas | $2,046,348 |

Solo se genera una sugerencia: reducir el cupo a lo viable manteniendo el plazo que pidio el cliente. No se ofrece la opcion de ampliar plazo (eliminada por el principio de credito sin intereses). La sugerencia de plazo menor no aplica aqui porque el plazo recomendado coincide con el solicitado.

El analista puede usar esta alternativa para negociar un cupo realista con el cliente sin rechazar la solicitud de plano.

### Ejemplo 3: Credito rechazado, SIN sugerencias de pago ($50,000,000 a 60 dias)

**Datos del cliente (empresa solida pero cupo desproporcionado):**

- Cupo total solicitado: $50,000,000
- Plazo solicitado: 60 dias (2 cuotas)
- Cuota mensual estimada: $50,000,000 / 2 = $25,000,000
- Capacidad de pago mensual: $3,579,187 (positiva)
- Rotacion de cartera: 67 dias
- Exposicion: $50M / $3,579,187 = **13.97 meses de caja** (casi 14 meses de toda la generacion de caja del cliente)

**Evaluacion por dimension:**

| Dimension | Puntaje | Reason |
|-----------|---------|--------|
| Salud Financiera | 20/20 | Z-Score > 3.0 — zona segura |
| Capacidad de Pago | 0/20 | Cuota $25,000,000 >> capacidad $3,579,187. Deficit 85.7% |
| Coherencia de Plazos | 10/20 | Plazo 60d < rotacion 67d, pero cubre el 89% (>= 70%) |
| Adecuacion del Cupo | 0/20 | $50M excede 598% el maximo para 60d ($7,158,374) |
| Exposicion / Eficiencia | 0/20 | Exposicion 13.97 meses de caja, muy por encima del ciclo. Mal negocio para el prestamista. |
| **Total** | **30/100** | |

**Veredicto: RECHAZADO** (puntaje 30 < 40)

**Sugerencias de pago generadas: NINGUNA.**

Aunque la empresa tiene capacidad de pago positiva, el cupo solicitado es tan desproporcionado frente a su flujo que el estudio se rechaza. La nueva Dimension 5 lo refuerza: una exposicion de ~14 meses de caja seria pesima para el prestamista incluso si el cliente pudiera pagarla. En consecuencia:

- **No se generan sugerencias de pago.** Ofrecer alternativas de cuotas a un cliente rechazado seria enganoso: ninguna de ellas refleja la solicitud que hizo. La solicitud debe rehacerse con un cupo realista.
- **No se sugiere ampliar plazo.** Pagar $50,000,000 a la capacidad del cliente requeriria ~420 dias. El sistema ya no contempla ampliar plazo bajo ninguna circunstancia: un plazo asi de largo, sin intereses, carece de sentido comercial.

El analista que vea este estudio entiende de inmediato que el cliente NO califica para $50M, y que el camino es solicitar un cupo dentro de su capacidad (alrededor de $7M para 60 dias).

---

## 6. Estructura de la Respuesta (JSON)

Cada dimension retorna los siguientes campos:

```json
{
  "score": 20,
  "maxScore": 20,
  "status": "healthy",
  "label": "Salud Financiera",
  "reason": "Los indicadores de liquidez, rentabilidad y apalancamiento situan a la empresa en zona segura."
}
```

Las sugerencias de pago retornan (solo tipos `adjusted_credit` y `recommended_term`; `adjusted_term` fue eliminado):

```json
{
  "type": "adjusted_credit",
  "suggestedTerm": 60,
  "suggestedCredit": 4092696,
  "numberOfPayments": 2,
  "paymentAmount": 2046348,
  "description": "Mantener plazo de 60 dias reduciendo cupo a $4.092.696: 2 cuotas de $2.046.348."
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

### Rotacion de Cartera como senal de riesgo del cliente

La rotacion de cartera se usa como referencia para evaluar el **riesgo de impago del cliente** (Dimension 3) porque:
- Refleja cuantos dias tarda el cliente en cobrar a sus propios clientes
- Si el credito vence antes de que el cliente cobre, no tendra flujo para pagar
- Es un indicador objetivo basado en datos reales del negocio

El tiempo de pago a proveedores es informativo pero no define el plazo porque:
- Indica la politica de pago del cliente, no su capacidad de cobro
- Puede estar distorsionado por acuerdos comerciales especificos
- No refleja directamente cuando el cliente recibe efectivo

**Importante (cambio de version):** la rotacion de cartera **ya NO empuja el plazo recomendado hacia arriba.** En versiones anteriores, si el cliente cobraba a 67 dias pero pedia 60, el sistema tendia a recomendar 67 dias. Esto era un error de diseno para un credito **sin intereses**: ampliar el plazo solo beneficia al cliente y perjudica al prestamista (mas capital inmovilizado, sin rendimiento que lo compense). Ahora el desajuste se reporta como **alerta de riesgo**, pero el plazo recomendado nunca supera el solicitado.

### Ciclo de Conversion de Efectivo (CCC) como umbral derivado de datos

Para la perspectiva del **prestamista** (Dimension 5: Exposicion / Eficiencia del Capital), el modelo usa el **Ciclo de Conversion de Efectivo**:

```
CCC = Rotacion de Inventarios + Rotacion de Cartera - Tiempo de pago a Proveedores
```

El CCC es el indicador estandar de la administracion del capital de trabajo y mide el **plazo natural del negocio** del cliente: cuantos dias transcurren entre que invierte efectivo (compra/produce) y lo recupera (cobra). Su gran ventaja es que **se deriva enteramente de los estados financieros del propio cliente**, por lo que define un umbral de plazo "sano" especifico para cada empresa, sin recurrir a un numero fijo arbitrario.

Esto resuelve un problema conceptual clave: un plazo de "50 dias" no significa lo mismo para un cupo de $5.000.000 que para uno de $500.000.000, ni para un colegio que cobra de contado que para una manufactura con 90 dias de inventario. El modelo no juzga el plazo en abstracto, sino la **exposicion relativa al ciclo de caja del cliente** (ratio adimensional).

### Cobertura de capacidad (DSCR) y exposicion

La Dimension 5 tambien se apoya en la logica del **Debt Service Coverage Ratio (DSCR)**, estandar en la banca para medir si el flujo del deudor cubre el servicio de la deuda. Llevado a la exposicion total de un credito sin intereses: el prestamo no deberia exceder lo que el cliente genera durante su propio ciclo de cobro. La metrica `exposureMonths = cupo / capacidad mensual` expresa cuantos meses de generacion de caja equivale el prestamo, y se compara contra el ciclo del cliente para puntuar la eficiencia del capital.

**Cotas aplicadas al plazo recomendado:**

- **Piso minimo de 30 dias:** un credito comercial debe ser al menos mensual, aunque el cliente cobre casi de contado (ej: colegios, retail).
- **Nunca mayor al plazo solicitado:** el sistema jamas amplia el plazo. Si el ciclo del cliente es mas corto, puede recomendar un plazo **menor** (recuperar antes es mejor para el prestamista).

  Formula: `recommendedTerm = MIN(requestedTerm, MAX(cashConversionCycle, 30))`

**Referencias:**
- Gitman, L.J. & Zutter, C.J. "Principles of Managerial Finance" (Pearson), capitulos sobre administracion del capital de trabajo y ciclo de conversion de efectivo.
- Brigham, E.F. & Houston, J.F. "Fundamentals of Financial Management", sobre el ciclo de conversion de efectivo y los ratios de cobertura.

---

## 8. Limitaciones del Modelo

1. **Datos historicos:** El modelo se basa en estados financieros pasados, no proyecciones. La situacion del cliente puede cambiar.
2. **Calidad de la informacion:** Los resultados son tan confiables como los estados financieros ingresados. Se recomienda usar estados financieros auditados o certificados por contador.
3. **Z-Score de Altman:** Fue disenado para empresas manufactureras cotizadas en bolsa. Para PYMES colombianas, los umbrales pueden no ser exactos, pero la direccion del indicador sigue siendo valida.
4. **Sector economico:** El modelo no diferencia por sector. Empresas de servicios con cero inventario o empresas con ciclos estacionales pueden requerir analisis adicional.
5. **Un solo periodo:** El analisis se basa en un periodo contable. Se recomienda revisar tendencias de multiples periodos cuando sea posible.
6. **Cuotas uniformes:** Las sugerencias asumen cuotas de igual monto. En la practica, la empresa podria preferir esquemas con cuotas variables o un solo pago al vencimiento.
