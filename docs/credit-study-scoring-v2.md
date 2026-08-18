# Modelo de scoring v2 — dimensiones configurables + configuración versionada

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
| **Fuente de cálculo** | **DataCrédito** (fuente de verdad, no maquillable), pero SOLO si su año más reciente **coincide** con el del PDF. Fallback a PDF si el cliente no tiene EEFF en la central **o si el año más reciente del PDF aún no aparece reportado** (p. ej. cargado en ene-mar antes de la ventana de reporte) — en ese caso la Veracidad se penaliza (§4.6). El usuario puede **forzar la fuente** en el perform (`source`) cuando la central reporta EEFF incompletos; el resultado lo declara (`summary.sourceSelection: 'manual'`). |
| **Rol del PDF** | Insumo del **contraste** (detección de maquillaje), ya no del cálculo. |
| **Dimensiones** | Las 5 actuales + **Dim 6 Veracidad** + **Dim 7 Riesgo de la central** = 7. |
| **Dim 6 (Veracidad)** | Maquillaje penaliza la dimensión (no elimina). Umbrales: >10% warning, >25% danger. |
| **Dim 7 (Riesgo central)** | Dimensión propia. Se apoya en lo que Experian ve y **nosotros no** (nivel/rating/comportamiento de pago), NO en la salud del balance (evita doble conteo con Dim 1). |
| **Score total** | **Pesos por importancia** (no ×20 uniforme), suman 100. |
| **Pesos** | **Configurables por empresa**, versionados en el tiempo. |
| **Config por estudio** | El `scoringConfigurationId` vigente se graba en el `CreditStudy` **al realizar el análisis** (congelación por referencia). |
| **Peso mínimo** | Cada dimensión **habilitada** tiene un piso (5): apagar una dimensión se hace deshabilitándola en la config, nunca dejándola con peso simbólico. |
| **Dimensiones configurables** *(v2.1)* | Cada empresa habilita las dimensiones del catálogo que quiera usar; las obligatorias (capacidad de pago, riesgo de la central) no se pueden apagar. Ver §5. |
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

## 4. Las dimensiones: qué mide cada una, con qué datos y cómo puntúa

> Esta sección está escrita para que la entienda cualquier persona del negocio,
> sin conocimientos técnicos ni contables profundos. Cada término se explica la
> primera vez que aparece. Para verla aplicada con números reales, ver los tres
> escenarios de la §13.

Una **dimensión** es una pregunta concreta sobre el cliente que se estudia
("¿puede pagar la cuota?", "¿dice la verdad en sus estados financieros?"). El
motor responde cada pregunta con un **puntaje de cumplimiento entre 0 y 1**
(0 = incumple del todo, 1 = cumple del todo, con escalones intermedios). Ese
cumplimiento se multiplica por el **peso** que la empresa le asignó a la
dimensión, y la suma de todas las dimensiones da el **score de viabilidad
(0 a 100)**:

```
puntos de una dimensión = cumplimiento (0..1) × peso configurado
score de viabilidad     = suma de los puntos de las dimensiones habilitadas
```

Qué dimensiones participan lo decide **cada empresa** en su configuración (§5):
habilita las del catálogo que le interesen y reparte 100 puntos de peso entre
ellas. Dos son **obligatorias** y no pueden apagarse — Capacidad de pago y
Riesgo de la central — porque sin ellas el estudio pierde sentido como análisis
de crédito. Una dimensión deshabilitada no se evalúa, no aparece en el
resultado y no suma ni resta.

| # | Dimensión (`code`) | La pregunta que responde | Obligatoria |
|---|--------------------|--------------------------|:-----------:|
| 1 | Salud financiera (`financialHealth`) | ¿El negocio es sólido o muestra señales de quiebra? | No |
| 2 | Capacidad de pago (`paymentCapacity`) | ¿Su capacidad acumula en el plazo lo suficiente para el pago único al vencimiento? | **Sí** |
| 3 | Coherencia de plazos (`termCoherence`) | ¿El plazo pedido calza con la velocidad a la que él cobra? | No |
| ~~4~~ | ~~Adecuación del cupo (`creditLineAdequacy`)~~ | **FUSIONADA en la Dim 2** (ver 4.4): medía lo mismo desde el otro lado; el techo del `montoSugerido` dejó de ser techo | — |
| 5 | Exposición del capital (`capitalExposure`) | ¿El crédito inmoviliza más capital del razonable para su operación? | No |
| 6 | Veracidad (`veracity`) | ¿Las cifras que reportó coinciden con las de la central? (solo PJ) | No |
| 7 | Riesgo de la central (`centralRisk`) | ¿Qué opina DataCrédito de su comportamiento crediticio? | **Sí** |

Las cifras financieras salen de **DataCrédito** (fuente de verdad, no
maquillable); si la central no tiene estados financieros del cliente, se usa el
PDF que él aportó, dejando la salvedad declarada en el resultado (§11). El
usuario también puede **elegir la fuente manualmente** en el perform (ver
"Selección manual de la fuente"), porque los EEFF que reporta la central a
veces vienen incompletos (rubros en "-", totales en 0) y el análisis automático
saldría no viable injustamente.

### 4.1 Dim 1 — Salud financiera (`financialHealth`)

**La pregunta:** ¿el negocio del cliente es estructuralmente sólido, o muestra
señales de que podría quebrar?

**Los datos que usa** (del balance y el estado de resultados): activos y
pasivos (totales y corrientes), utilidades retenidas, utilidad operacional,
patrimonio e ingresos.

**Cómo se calcula.** Se usa el **Z-Score de Altman**, un método clásico de la
banca (1968, vigente hoy) que combina cinco señales del negocio en un solo
número. En palabras simples, las cinco señales son:

1. **Liquidez** — cuánto colchón de corto plazo tiene frente a su tamaño:
   (activo corriente − pasivo corriente) ÷ activo total.
2. **Historia de rentabilidad** — cuánta utilidad ha acumulado en su vida
   frente a su tamaño: utilidades retenidas ÷ activo total. Un negocio que
   arrastra pérdidas acumuladas puntúa negativo aquí.
3. **Rentabilidad actual** — cuánta utilidad operacional genera su activo:
   utilidad operacional ÷ activo total. Es la señal que más pesa en la fórmula.
4. **Solvencia** — cuánto patrimonio respalda cada peso de deuda:
   patrimonio ÷ pasivo total.
5. **Eficiencia** — cuántas ventas genera cada peso invertido en activos:
   ingresos ÷ activo total.

```
Z = 1.2×(liquidez) + 1.4×(historia) + 3.3×(rentabilidad) + 0.6×(solvencia) + 1.0×(eficiencia)
```

**Cómo puntúa:**

| Z-Score | Zona | Cumplimiento | Significado |
|---------|------|-------------:|-------------|
| > 3.0 | Segura | **1.0** | Indicadores sólidos, baja probabilidad de riesgo |
| 1.8 – 3.0 | Gris | **0.5** | Zona de observación: se recomienda monitoreo |
| < 1.8 | Crítica | **0.0** | Alta probabilidad de incumplimiento |

La zona se traduce internamente en un **factor de estabilidad** (1, 0.66 o
0.33) que además **descuenta el EBITDA en la Dim 2**: a un negocio frágil se le
cree menos capacidad de pago (ver 4.2). Por diseño, una mala salud financiera
castiga dos veces.

### 4.2 Dim 2 — Capacidad de pago (`paymentCapacity`) — obligatoria

**La pregunta:** después de atender sus deudas actuales, ¿le queda caja
suficiente cada mes para pagar la cuota del crédito que está pidiendo? (Integra
la antigua "Adecuación del cupo": la cuota ya combina cupo Y plazo, así que la
misma medida juzga también el tamaño del monto pedido — ver 4.4.)

**Los datos que usa:** ingresos, costos y gastos (para derivar el EBITDA), las
deudas financieras de corto plazo y los gastos financieros (su "servicio de
deuda" actual), y el cupo + plazo solicitados.

> **`financialExpenses` = solo INTERESES (2026-07-26).** En los ERI colombianos
> el rubro "Gastos financieros" suele mezclar gastos bancarios, comisiones, GMF
> (4×1000) y diversos con los intereses de la deuda. Para el servicio de deuda
> solo pesan los **intereses** (costo de financiación de obligaciones), así que
> la extracción del PDF toma únicamente las partidas de intereses del desglose
> de la nota. Caso real que lo motivó: una nota de gastos financieros de
> $1.026.178 compuesta 100% por gastos bancarios/gravamen/comisiones — cero
> intereses → `financialExpenses: 0`. Reglas del prompt: nota desglosada sin
> intereses → `0`; total sin desglose en notas → se usa el total como
> aproximación + reliabilityFlag `info` (categoría `notas`) dejando constancia;
> rubro ausente → `null`. Los EEFF de DataCrédito no traen este rubro (el campo
> va `null` en esa fuente, servicio de deuda = solo obligaciones CP).

**Cómo se calcula, paso a paso:**

1. **EBITDA** — la utilidad que deja la operación pura del negocio: ingresos −
   costo de ventas − gastos de administración − gastos de ventas (+ depreciación
   y amortización cuando la fuente las desglosa; DataCrédito no lo hace — ver
   §3 —, lo que deja el cálculo más conservador).
2. **EBITDA ajustado** = EBITDA × factor de estabilidad de la Dim 1 (1, 0.66 o
   0.33). Racional: a un negocio en zona gris o crítica no se le puede creer el
   100% de su utilidad como capacidad de pago real.
3. **Capacidad de pago anual** = EBITDA ajustado − servicio de deuda actual
   (obligaciones financieras de corto plazo + gastos financieros). Es lo que de
   verdad le queda al año para asumir deuda NUEVA.
4. **Capacidad mensual** = capacidad anual ÷ 12.
5. **Pago único al vencimiento** — el crédito comercial se paga **COMPLETO al
   final del plazo** (no hay cuotas mensuales ni intereses). Lo que debe
   pagarse es el cupo, el día del vencimiento.
6. **Capacidad acumulada en el plazo** = capacidad mensual × (plazo en días ÷
   30). Ejemplo: capacidad de $5M/mes a 60 días → acumula $10M para ese pago.
7. **Cobertura** = capacidad acumulada en el plazo ÷ pago al vencimiento:
   cuántas veces lo que el cliente junta en esos días cubre lo que debe pagar.

> ⚠️ **Cambio 2026-07-25 (pago único, no cuotas):** antes esta medida se
> expresaba como "cuota mensual estimada" (cupo ÷ plazo/30) vs capacidad
> mensual. La división es LA MISMA (el score no cambió un decimal), pero en
> plazos < 30 días la "cuota" extrapolada superaba el propio cupo (pedir $20M a
> 20 días producía una "cuota de $30M/mes") y confundía la lectura: el cliente
> nunca paga cuotas, paga UNA vez al vencimiento. Alertas, `keyFigures`
> (`paymentAtMaturity` + `capacityInTerm` reemplazan a `estimatedMonthlyQuota`)
> y el prompt del informe IA hablan ahora de pago único.

**Cómo puntúa:**

| Cobertura | Estado | Cumplimiento |
|-----------|--------|-------------:|
| ≥ 1.2 (le sobra 20% o más) | Holgada | **1.0** |
| 1.0 – 1.2 (cubre, pero justo) | Ajustada | **0.6** (warning) |
| < 1.0 (no alcanza) | Insuficiente | **0.0** (danger) |

Los mensajes de la dimensión explicitan además el **máximo pagable en el plazo
pedido** (capacidad mensual × plazo ÷ 30): la vista "cupo" de la misma medida.

**Señal de la central (no puntúa).** Si hubo consulta y el cupo solicitado
supera **mucho** el `montoSugerido` de la central, la dimensión agrega una
alerta informativa: > 1.5× → `warning`; > 3× → `danger`
(`SUGGESTED_AMOUNT_ALERT_WARNING` / `_DANGER`). No altera el score ni recorta
el monto: en el mercado real el `montoSugerido` suele ser muy conservador
frente a lo que los EEFF del cliente soportan (ver 4.8); el analista pondera.

**El ingreso de la central MANDA (SOLO PN — sí puntúa).** Para persona natural
la central reporta dos datos de endeudamiento que la PJ no tiene:
`reportedIncome` (ingreso mensual del titular) y `quotaToIncomePct` (% del
ingreso ya comprometido en cuotas vigentes). Como una PN no tiene EEFF reales
—el PDF es auto-reportado, y un asalariado ni siquiera tiene estados
financieros—, ese ingreso certificado por la central **acota la capacidad de
pago** (regla implementada 2026-07-25; antes era solo una alerta informativa):

```
ingreso disponible     = reportedIncome × (1 − quotaToIncomePct/100)
capacidad efectiva PN  = min(capacidad según EEFF, ingreso disponible)
```

La capacidad **efectiva** gobierna TODO: el ratio de esta dimensión, el máximo
pagable —y por tanto el **monto avalado** (4.8)—, la regla eliminatoria y las
`keyFigures` que ve el front. Cuando el ingreso recorta, el motor agrega una
alerta `info` que lo declara ("la capacidad de pago se limitó al ingreso mensual
disponible según la central…"). En PJ —o en PN sin ingreso reportado— mandan los
EEFF, como siempre.

Queda además una alerta de contraste (`incomeReferenceAlerts`): **`danger`** si
la capacidad que implican los EEFF del PDF supera el ingreso reportado — *una
persona no puede destinar a pagar más de lo que gana* → señal de PDF inflado
("revise la veracidad del PDF"). Es el sustituto natural de la Veracidad para
PN. La antigua alerta de "cuota vs ingreso disponible" se eliminó: ya no hace
falta, porque el ingreso disponible ES la capacidad efectiva y ese exceso lo
expresan el ratio de la dimensión y el recorte del monto avalado.

**Caso real que motivó la regla:** ingreso $6.964.000/mes con 29,5% ya
comprometido → disponible **$4.909.620/mes**. Si pide $10M a 60 días (cuota de
$5,2M/mes), antes un PDF favorable lo avalaba con un simple warning; ahora la
cobertura se mide contra los $4,9M reales y el monto se recorta al máximo
pagable ($4.909.620 × 2 ≈ **$9,8M**). Ver el caso trabajado en §13.6.

> ⚠️ **Regla eliminatoria:** si la capacidad mensual **efectiva** es **≤ 0**, el
> estudio se **rechaza directo** (§6.2). El motivo distingue la causa: en PN con
> el ingreso totalmente comprometido en cuotas, el `eliminatoryReason` lo dice
> explícitamente (no culpa al EBITDA).

### 4.3 Dim 3 — Coherencia de plazos (`termCoherence`)

**La pregunta:** ¿el plazo que pide para pagarnos calza con la velocidad a la
que él le cobra a sus propios clientes?

**Los datos que usa:** el plazo solicitado (días) y la **rotación de cartera**
del cliente: cuántos días tarda, en promedio, en cobrar sus facturas (cartera
promedio ÷ ingresos × 365).

**Cómo se calcula.** Si un cliente cobra a 90 días pero nos pide plazo de 30,
tendrá que pagarnos ANTES de recibir la plata de sus propios clientes: esa
brecha la financia de su bolsillo (capital de trabajo) y le tensiona la caja.

**Cómo puntúa:**

| Comparación | Estado | Cumplimiento |
|-------------|--------|-------------:|
| Plazo ≥ rotación (cobra antes de pagarnos) | Cómodo | **1.0** |
| Plazo ≥ 70% de la rotación (brecha manejable) | Ajustado | **0.5** (warning) |
| Plazo < 70% de la rotación | Tensionado | **0.0** (warning) |

> ⚠️ **Lectura correcta:** esta dimensión mide **tensión de caja del cliente**,
> NO riesgo de impago para Creditia — que el cliente nos pague rápido es MÁS
> seguro, no menos. Se penaliza porque una brecha grande puede derivar en pago
> tardío si el cliente no tiene colchón. El informe IA tiene instrucción
> explícita de no describirla nunca como riesgo de incumplimiento.

### 4.4 Dim 4 — Adecuación del cupo (`creditLineAdequacy`) — FUSIONADA en la Dim 2

Esta dimensión **ya no existe como dimensión propia**: se fusionó en la
Capacidad de pago (4.2). Dos razones:

1. **Medían lo mismo desde lados opuestos.** El techo por capacidad de esta
   dimensión (cupo ÷ máximo pagable) es el **inverso matemático** de la
   cobertura de la Dim 2 (capacidad acumulada en el plazo ÷ pago al
   vencimiento): tener ambas con peso era contar dos veces la misma señal, y de
   cara al cliente eran dos análisis a medias que confundían.
2. **El otro techo (el `montoSugerido` de la central) dejó de ser techo.** En
   el mercado real ese monto es muy conservador: clientes con EEFF que soportan
   holgadamente el cupo pedido recibían montos sugeridos bajísimos, y el techo
   los castigaba y recortaba sin razón financiera. El `montoSugerido` pasó a
   ser **señal** (alertas 1.5×/3× en la Dim 2, ver 4.8), no autoridad de monto.

En BD la fila `creditLineAdequacy` se **eliminó del catálogo** (excepción a la
regla de "sin borrado físico": no había estudios históricos que proteger); los
pesos que las empresas le tenían asignado se **sumaron al de `paymentCapacity`**
por migración (los pesos siguen sumando 100).

### 4.5 Dim 5 — Exposición del capital (`capitalExposure`)

**La pregunta:** ¿cuánto capital de la empresa prestamista queda inmovilizado,
y por cuánto tiempo, frente a lo razonable para la operación del cliente? (El
crédito comercial es sin intereses: el "costo" real del prestamista es tener la
plata quieta.)

**Los datos que usa:** el cupo pedido, la capacidad de pago mensual (Dim 2) y
el **ciclo de conversión de caja** del cliente:

```
ciclo de caja (días) = días en cobrar (rotación de cartera)
                     + días con mercancía en bodega (rotación de inventarios)
                     − días que le fían sus proveedores
```

El ciclo de caja es el tiempo que el dinero del cliente permanece "atrapado" en
la operación antes de volver a ser efectivo. (Si sale menor a 30 días, se usa
30 como piso.)

**Cómo se calcula.** La **exposición sana** = capacidad mensual × (ciclo de
caja ÷ 30): el capital que la operación del cliente puede absorber y devolver
sin atascarse. Se compara el cupo pedido contra ella:

| Pedido ÷ exposición sana | Estado | Cumplimiento |
|--------------------------|--------|-------------:|
| ≤ 1.0 | Eficiente | **1.0** |
| ≤ 1.5 | Aceptable | **0.6** (warning) |
| > 1.5 | Excesiva | **0.0** (danger) |

### 4.6 Dim 6 — Veracidad (`veracity`) — contraste PDF ↔ DataCrédito

**La pregunta:** ¿las cifras que el cliente reportó en su PDF coinciden con las
que la central de riesgo tiene registradas? Un negocio que "infla" sus estados
financieros para conseguir cupo es una de las señales más graves del análisis.

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
- **Emparejamiento por año fiscal (⚠️ regla clave):** el contraste SOLO es
  válido entre el **mismo año** de ambas fuentes. Si el año más reciente del
  PDF **no coincide** con el más reciente de la central (típico: EEFF del año
  N cargados en enero–marzo de N+1, cuando la central todavía va en N−1 porque
  el plazo de reporte a las entidades no ha vencido — la misma ventana de la
  red flag de `verificabilidad` de la extracción):
  - El **cálculo de las demás dimensiones corre sobre el PDF** (es el año más
    nuevo; la central no lo puede confirmar ni desmentir), con
    `calculationSource: 'pdf'` y la alerta general explicando el porqué.
  - La **Veracidad se penaliza fuerte** en PJ: puntúa **0**
    (`status: 'period_mismatch'`, alerta `danger` con ambos años). No se
    contrasta un año común más viejo: el período que sustenta el cálculo es el
    que no tiene respaldo. La central vuelve a ser la fuente del cálculo (y el
    contraste se rehace) cuando publique ese año y se re-analice.
- **Cuando falta una fuente, el trato DEPENDE del tipo de persona**: la
  Veracidad necesita **ambas** fuentes (PDF + EEFF de la central) para
  contrastar. Si falta una:
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

### 4.7 Dim 7 — Riesgo de la central (`centralRisk`) — obligatoria

**La pregunta:** ¿qué opina DataCrédito Experian del comportamiento crediticio
del cliente? Es la mirada de un tercero experto e independiente: cómo ha pagado
sus obligaciones en todo el sistema financiero, no solo lo que dicen sus
estados financieros.

Usa la opinión de Experian que **nosotros no podemos derivar** de los EEFF:
`nivel` de riesgo, `ratingSectorial`, comportamiento de pago (mora/historial).
**No** usa la salud del balance (eso ya lo mide Dim 1 → evita doble conteo).

**Fórmula rica.** ⚠️ **La implementación final usa el `puntajeScore` (150-950)
mapeado a bandas** como base (más granular que el `nivel`), penalizado por sector
y mora — ver §11 para la tabla de bandas definitiva. El `nivel` quedó como
respaldo si no viene score. El esquema conceptual (base − penalizaciones) es:

```
base = puntajeScore → banda (§11):  ≥750 → 1.0 ... <500 → 0.0
       (respaldo sin score — PJ: nivel BAJO → 0.9 | MEDIO → 0.5 | ALTO → 0.1
                             PN: viabilidad ALTA → 0.9 | MEDIA → 0.5 | BAJA → 0.1)
penalización sectorial: si ratingSectorial ∈ {ALTO, 4, 5} → −0.15
penalización por mora:  GRADUADA por severidad × recencia (ver abajo);
                        hasta −0.40 en el peor caso
ratio_7 = clamp(base − penalizaciones, 0, 1)
```

> **Campos PN vs PJ (importante):** `nivelRiesgo` y `ratingSectorial` **solo
> existen para PJ** — en PN siempre llegan null. El equivalente PN es la
> **`viabilidad` de pago** (ALTA/MEDIA/BAJA, "cliente con alta probabilidad de
> pago") y el **`ratingRecaudos`** (A..D, facilidad de cobro). Por eso el
> respaldo de banda sin score usa `nivel` en PJ y `viabilidad` en PN (antes un
> PN sin score quedaba `not_evaluable` aunque la central sí opinara). Ambos
> campos PN viajan además en `result.reference` (`experianViability`,
> `experianCollectionRating`) para que el front y el informe IA muestren la
> opinión de la central también en persona natural.

> Nota: pedir por encima del `montoSugerido` **ya no penaliza** esta dimensión
> (antes restaba −0.15). Es una señal informativa que se alerta en la Dim 2
> (contraste pedido vs monto sugerido, 1.5×/3×); el riesgo de la central se
> mide con lo que la central sí sabe: score, sector y comportamiento de pago.

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

### 4.8 El `montoSugerido` de la central: SEÑAL, no techo

La central devuelve un `montoSugerido`: el monto máximo que Experian avala para
el cliente. **Dejó de ser techo del cupo.** La razón es del mercado real: ese
monto suele ser muy conservador — clientes cuyo analista financiero, con los
EEFF y el comportamiento a la vista, avala $50M reciben montos sugeridos de
$20M. Con el techo activo, Creditia arrastraba ese mismo problema (caso Líneas
Hospitalarias). Hoy **el monto lo mandan los EEFF** (sean de DataCrédito o del
PDF); la central aporta señal:

1. **Alertas en la Dim 2** cuando el pedido supera mucho el `montoSugerido`:
   > 1.5× → `warning`; > 3× → `danger`. Informativas, sin tocar el score.
2. **Monto aprobado por Creditia** (`recommendedCreditLine`): el cupo
   solicitado acotado al **máximo pagable según la capacidad de pago** para el
   plazo (capacidad mensual × plazo ÷ 30); si pide de más, se recorta a ese
   máximo. En PN la capacidad es la **efectiva** (acotada por el ingreso de la
   central, 4.2), así que el ingreso certificado también acota el monto. El
   `montoSugerido` NO recorta. Se persiste en `recommended_credit_line` y en el
   bloque `approvedCreditLine` del JSON:

   ```json
   "approvedCreditLine": {
     "amount": 50000000,           // lo que Creditia avala (según EEFF)
     "requested": 50000000,        // lo que pidió el cliente
     "suggestedByBureau": 20000000,// referencia de la central (NO recorta)
     "cappedByCapacity": false     // true si se recortó al máximo pagable
   }
   ```

3. **`montoSugerido` distingue `null` de `0`**: `null` = no hubo consulta a la
   central → sin señal. `0` = la central no lo reconoce como sujeto de crédito
   → red flag `danger` + **cap de veredicto a `conditional`** (nunca
   `approved` automático, ver §6.2). Ya **no** es eliminatorio ni recorta el
   monto: si los EEFF sostienen la operación, la decisión queda en manos del
   analista.

### 4.9 Las TRES capas de red flags (y sus categorías legibles)

El resultado del análisis lleva tres familias de alertas, cada una con origen y
momento distintos. No se mezclan:

| Capa | Qué audita | Cuándo se genera | Dónde vive en el resultado |
|------|------------|------------------|----------------------------|
| **`pdfReliabilityFlags`** | El PDF **contra sí mismo** (balance que no cuadra, utilidad sospechosa, transacciones con socios, notas contradictorias) | Al **extraer el PDF** (IA) | `result.pdfReliabilityFlags` (el servicio las copia del análisis `pdf` al realizar el estudio) |
| **`centralRiskFlags`** | Señales de la **central** independientes del PDF | Al **realizar el estudio** (motor) | `result.centralRiskFlags` |
| **`alerts`** | Las dimensiones habilitadas + salvedades de fuente + eliminatorios | Al **realizar el estudio** (motor) | `result.alerts` |

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

**Signo de los costos y gastos en la extracción (regla de SIGNOS, 2026-07-25).**
El estado de resultados presenta costos y gastos **entre paréntesis** —
"(44.339.000)" — como convención de que la partida *se resta*, no de que sea
negativa. Un caso real (PJ con EEFF 2025) mostró que la IA los devolvía con
signo negativo y, como las fórmulas de `financial-indicators.ts` restan esas
partidas por sí mismas, restar un negativo **sumaba**: EBITDA $266,8M en vez de
$21,0M y capacidad de pago mensual $22,3M en vez de $1,66M (~13× infladas, a
favor del cliente), además de rotaciones negativas. Se corrigió en dos capas,
igual que la regla de escala en miles:

1. **Prompt de extracción**: bloque "SIGNO DE LAS CIFRAS" — los 7 campos de
   costo/gasto (`costOfSales`, `administrativeExpenses`, `sellingExpenses`,
   `depreciation`, `amortization`, `financialExpenses`, `taxes`) se devuelven
   SIEMPRE como magnitud positiva; el signo negativo se reserva para conceptos
   realmente negativos (`netIncome` en pérdida, `retainedEarnings` con pérdidas
   acumuladas, `equity` negativo, `grossProfit` en pérdida bruta).
2. **Cinturón determinístico** en `financial-statements.service.ts`
   (`EXPENSE_MAGNITUDE_FIELDS`): al persistir la extracción se aplica
   `Math.abs()` sobre esos 7 campos, sin confiar solo en el prompt. El mapper de
   DataCrédito no lo necesita (la central entrega magnitudes positivas).

Los análisis extraídos antes del fix conservan los signos invertidos congelados
(fase de pruebas, sin backfill): re-cargar el PDF del estudio regenera todo.

### 4.10 Cómo se comporta el modelo con una Persona Natural (PN)

Las dimensiones de §4 se escribieron pensando en una empresa (PJ), pero el motor
es el **mismo** para PN: corre las mismas fórmulas con dos diferencias
estructurales, no una lógica aparte. Esta sección las consolida para que quede
claro **qué cambia y qué no** cuando el cliente estudiado es una persona natural.

**Punto de partida — de dónde salen las cifras.** La central (DataCrédito) **no
reporta estados financieros de una PN** (a diferencia de la PJ, obligada a
reportarlos). Por eso, para PN la fuente de las cifras es **siempre el PDF** que
el titular carga: `createFromBureau` deja todo estudio en
`pendingFinancialStatements` y la PN **exige PDF** para poder analizarse. En el
resultado esto se declara: `calculationSource: 'pdf'`, `financialsVerified:
false`, y una alerta `warning` de "cifras auto-reportadas, sin verificar contra
la central" (§11 — salvedad de la fuente).

**Qué dimensiones aplican a una PN** (con los pesos default PN de §5.2):

| Dimensión | ¿Aplica a PN? | Cómo se calcula |
|-----------|:-------------:|-----------------|
| Salud financiera | **Sí** | Z-Altman sobre los EEFF del PDF (idéntico a PJ). |
| Capacidad de pago | **Sí** (obligatoria) | EBITDA→capacidad→cobertura sobre el PDF, pero la capacidad queda **ACOTADA por el ingreso disponible de la central**: `capacidad efectiva = min(EEFF, ingreso × (1 − % comprometido))` (4.2). |
| Coherencia de plazos | **Sí** | Plazo pedido vs rotación de cartera del PDF (idéntico a PJ). |
| Exposición del capital | **Sí** | Ciclo de caja del PDF vs cupo (con la capacidad efectiva). |
| Veracidad | **No** (`not_evaluable`) | La central no tiene EEFF de PN → no hay balances que contrastar. Peso 0 por config; no se redistribuye porque nace en 0. Su función la cumple el **contraste de ingreso** (4.2). |
| Riesgo de la central | **Sí** (obligatoria) | Score/mora de la central. Sin score, el respaldo de banda es la **`viabilidad`** (ALTA/MEDIA/BAJA — campo que solo existe en PN); el rating sectorial solo existe en PJ. |

Es decir: **una PN se evalúa con 6 dimensiones** (todas menos la Veracidad), sobre
las cifras del PDF, con el ingreso certificado por la central **gobernando** la
capacidad de pago (no solo como referencia).

**Por qué el ingreso manda en PN.** En PJ la Veracidad detecta maquillaje
comparando el PDF contra los EEFF de la central. En PN no hay EEFF con qué
comparar, pero la central sí certifica el **ingreso mensual** del titular y el
**% ya comprometido** en cuotas. Ese es el único dato financiero *verificado* de
una persona natural, así que desde 2026-07-25 **acota la capacidad de pago
efectiva** (4.2): un PDF "optimista" ya no puede avalar montos que el sueldo
real no soporta — el ratio, el monto avalado y la eliminatoria se calculan
contra el ingreso disponible. Si además el PDF implica una capacidad mayor al
ingreso, salta la alerta `danger` de veracidad (una persona no paga con más de
lo que gana).

**Reglas eliminatorias y caps:** aplican igual que en PJ (capacidad efectiva ≤ 0
→ rechazo, con motivo específico si la causa es el ingreso totalmente
comprometido; riesgo alto de la central o `montoSugerido = 0` → cap
`conditional`). El estado legal (matrícula/liquidación) no aplica a PN porque no
tiene perfil de cámara de comercio (`bureauProfile` es null en PN).

**Caso límite pendiente:** una PN **sin PDF** sigue sin poder analizarse (el
flujo exige PDF para llegar al perform). Con la regla del ingreso, el PDF de un
asalariado ya no puede inflar el resultado — pero el modelo alterno "sin PDF"
(basar el análisis SOLO en ingreso + comportamiento de la central) sigue
pendiente de diseño en documento aparte.

**Sugerencias de verificación de la central.** La consulta trae un bloque
`sugerencias` (checklist de documentación que Experian recomienda pedir según el
perfil: certificado laboral si es empleado, certificado de ingresos de contador
si es independiente). Se archiva por snapshot (columna `suggestions`, migración
`20260725130000`) y el `GET /:id/steps` lo devuelve en
`step1.centralRisk.suggestions` como `[{ title, items[] }]`; el PDF del reporte
las imprime al cierre del bloque de la central. Es guía para el analista — el
complemento operativo de la regla del ingreso: la propia central dice CÓMO
verificar el ingreso del titular. No participa del scoring.

> Los snapshots consultados ANTES de la columna se **rellenaron por backfill**
> (2026-07-25, staging y prod) extrayendo el bloque desde el `rawResponse`
> archivado de su consulta — no hay ventana de `null` para consultas con
> sugerencias en el crudo.

### 4.11 Escala de los saldos de la central (miles → pesos completos)

En la respuesta de MiDecisor conviven **dos escalas**: `ingreso` y
`montoSugerido` vienen en **pesos completos**, pero los saldos y cuotas de
`indicadoresValores` y de sus sectores (`saldoActual`, `saldoMora`,
`valorCuota`…) vienen en **MILES de pesos**. Verificado con caso real: cuota
`"2053"` ÷ ingreso `6.964.000` = **29,5%** — exactamente el
`porcentajeCuotaVsIngreso` que la propia central reporta; solo cuadra si la
cuota son $2.053.000.

La normalización vive en la **frontera ACL**: `thousandsToPesos` (exportada de
`experian.mapper.ts`) multiplica ×1000 al mapear `saldoActual`/`saldoMora`
(escalares del snapshot y por sector), de modo que todo el dominio —snapshot,
steps, motor, front— habla en pesos completos. Las red flags de `saldoMora > 0`
nunca dependieron de la escala (cero es cero), pero cualquier display o cálculo
futuro sobre esos saldos ya no arrastra el error ×1000.

**Los EEFF de la central también vienen en MILES (fix 2026-08-16).** El bloque
`estadosFinancieros` (que alimenta el análisis `source='datacredito'` vía
`experian.financials.mapper.ts`) llegaba SIN escalar: los períodos quedaban en
miles mientras el PDF está en pesos. Prueba con caso real: "Total pasivo"
`17016` de la central vs `$17.015.977` del PDF del mismo período — la misma
cifra redondeada a miles (y utilidad neta `113164` = $113.164.000 en otro caso
PJ). El impacto era triple: (1) el step2 mostraba la fuente DataCrédito 1.000×
más pequeña; (2) los indicadores del análisis DC (EBITDA, capacidad) salían en
milésimas → estudios PJ rechazados injustamente cuando la central era la fuente
del cálculo; (3) la **Veracidad (Dim 6) contrastaba pesos contra miles** →
`manipulated` con danger FALSO siempre que había ambas fuentes del mismo año.
Ahora el pivot del financials mapper aplica `thousandsToPesos` a todas las
cuentas de `ACCOUNT_MAP` (todas monetarias; la categoría "Indicadores" — ratios
sin escalar — ya se ignoraba por diseño).

> ⚠️ Los snapshots y análisis `datacredito` creados **antes** de estas reglas
> quedaron guardados en miles; se corrigen solos en la siguiente consulta
> (frescura) o al re-cargar el PDF del estudio (que regenera el análisis DC).
> No se hizo backfill.

---

## 5. Modelo de datos: catálogo de dimensiones + configuración versionada

Tres tablas:

1. **`scoring_dimensions`** — catálogo global de dimensiones (lo administra
   Creditia desde el portal admin). Solo identidad/display (`code`, `label`,
   `description`, `isActive`, `sortOrder`); el **comportamiento** (función
   `eval*`, obligatoriedad, a qué tipo de persona aplica, defaults) vive en el
   motor (`scoring.constants.ts` → `DIMENSION_RULES`), keyed por `code`. Sin
   borrado físico: retirar una dimensión = `isActive=false`.
2. **`scoring_configurations`** — configuración **por empresa Y por tipo de
   persona**, **versionada**. Cada empresa tiene UNA config vigente por tipo
   (una PN + una PJ); cada tipo acumula N versiones, una `isActive=true`.
3. **`scoring_configuration_weights`** — las dimensiones **HABILITADAS** por
   cada versión, con su peso. **Una dimensión sin fila está deshabilitada: no se
   evalúa ni participa del estudio.** Los pesos habilitados suman 100.

La cadena: `Company → ScoringConfiguration → ScoringConfigurationWeight →
ScoringDimension`, y `CreditStudy.scoringConfigurationId` congela la versión
usada por cada estudio.

```prisma
model ScoringDimension {
  id          Int      @id @default(autoincrement())
  code        String   @unique @db.VarChar(50) // debe existir en SCORING_DIMENSIONS del motor
  label       String   @db.VarChar(150)
  description String?  @db.VarChar(500)
  isActive    Boolean  @default(true) @map("is_active")
  sortOrder   Int      @default(0) @map("sort_order")
  // ...
  weights ScoringConfigurationWeight[]
  @@map("scoring_dimensions")
}

model ScoringConfiguration {
  id           String @id @default(uuid()) @db.Uuid
  companyId    String @map("company_id") @db.Uuid
  personTypeId Int    @map("person_type_id") // Parameter person_type

  isActive  Boolean  @default(true) @map("is_active") // vigente (por empresa+tipo)
  createdBy String   @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  weights       ScoringConfigurationWeight[] // dimensiones habilitadas + pesos
  creditStudies CreditStudy[] // estudios congelados con esta config
  // ...
  @@index([companyId, personTypeId, isActive])
  @@map("scoring_configurations")
}

model ScoringConfigurationWeight {
  id          String @id @default(uuid()) @db.Uuid
  configId    String @map("config_id") @db.Uuid
  dimensionId Int    @map("dimension_id")
  weight      Int // >= MIN_WEIGHT; los de la config suman 100

  config    ScoringConfiguration @relation(fields: [configId], references: [id])
  dimension ScoringDimension     @relation(fields: [dimensionId], references: [id])
  @@unique([configId, dimensionId])
  @@map("scoring_configuration_weights")
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

- **Dimensiones configurables por empresa:** cada empresa decide qué dimensiones
  del catálogo usa (habilitada = fila en `scoring_configuration_weights`). El
  motor evalúa SOLO las habilitadas. Las **obligatorias** (`DIMENSION_RULES` →
  `paymentCapacity` y `centralRisk`) no pueden deshabilitarse: son el núcleo del
  estudio.
- **Reglas eliminatorias y caps SIEMPRE aplican:** matrícula cancelada/
  liquidación y capacidad de pago <= 0 (eliminatorias), y los caps a
  `conditional` (riesgo alto de la central, `montoSugerido=0`) son POLÍTICA de
  Creditia, independientes de qué dimensiones habilitó la empresa.
- **Agregar una dimensión 8:** deploy con su función `eval*` (y entrada en
  `SCORING_DIMENSIONS`/`DIMENSION_RULES`) + fila en `scoring_dimensions`. Los
  clientes la ven disponible (apagada) y deciden habilitarla; cero impacto en
  configs y estudios existentes.
- **Versionado por (empresa, tipo):** reconfigurar PN inserta una config PN nueva
  `isActive=true` (con sus filas de pesos) y desactiva la PN anterior; la PJ no
  se toca. La tabla completa es el historial; las versiones son inmutables.
- **Grabado en el estudio:** al **realizar el análisis** se copia el id de la
  config `isActive` del **tipo de persona del cliente** al `CreditStudy`. Los
  estudios viejos siguen apuntando a su config → sin recálculo retroactivo,
  auditable.
- **Validación consciente del tipo:** los pesos habilitados suman 100 (cada uno
  >= `MIN_WEIGHT`=5), las obligatorias están presentes y ninguna habilitada
  puede no aplicar al tipo (la **veracidad no aplica en PN**: sin EEFF de la
  central no hay contraste → no es habilitable). La regla la impone
  `validateWeights(weights, personType)`; que el `code` exista y esté activo en
  el catálogo lo valida el servicio.
- **Administración del catálogo:** solo el portal admin (`/admin/scoring-dimensions`)
  crea, edita lo básico (label/description/orden) y activa/desactiva. El `code`
  no es editable y no hay borrado físico. Cualquier usuario autenticado LEE el
  catálogo activo por `GET /scoring-dimensions` (incluye `required`, `appliesTo`
  y `supported` para que el front bloquee lo no configurable).

### 5.2 Config default al crear la empresa

Al nacer una empresa (en [`onboarding.service.ts`](../src/onboarding/onboarding.service.ts)),
se crean **DOS** `ScoringConfiguration` v1 (una PN + una PJ) con los **pesos
default del sistema** por tipo. Así toda empresa tiene config de ambos tipos desde
el día 1 sin obligar a configurar.

Defaults (`scoring.constants.ts` → `DEFAULT_WEIGHTS_PJ` / `DEFAULT_WEIGHTS_PN`):

| Dimensión | PJ | PN |
|-----------|---:|---:|
| Capacidad de pago | 32 | 38 |
| Veracidad | 20 | **0** |
| Riesgo de la central | 15 | 25 |
| Salud financiera | 15 | 19 |
| Exposición del capital | 10 | 10 |
| Coherencia de plazos | 8 | 8 |
| **Total** | **100** | **100** |

> La capacidad de pago absorbe los 12 puntos de la antigua "Adecuación del
> cupo" (fusionada en ella, ver 4.4). En **PN** la veracidad es 0 (no evaluable
> sin EEFF de la central) y sus puntos se reparten hacia riesgo de central,
> capacidad y salud: lo más confiable que se tiene de una persona natural es su
> comportamiento en la central.
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
| Capacidad de pago **efectiva** `<= 0` | `rejected` | Sin capacidad de pago. El motivo distingue la causa: servicio de deuda que se come el EBITDA (EEFF), o —en PN— ingreso mensual totalmente comprometido en cuotas vigentes (4.2). |

**Umbrales por score** (si ninguna eliminatoria aplica):

| Condición | Veredicto |
|-----------|-----------|
| `viabilityScore >= 75` | `approved` |
| `viabilityScore >= 40` | `conditional` |
| `viabilityScore < 40` | `rejected` |

**CAPs a `conditional`** (aplican DESPUÉS de los umbrales; bajan `approved` a
`conditional`, nunca fuerzan rechazo):

| Señal de la central | Efecto |
|---------------------|--------|
| **Riesgo alto** (`score < 500` o `nivelRiesgo` MÁXIMO/ALTO) | Tope `conditional`: un PDF auto-reportado no puede aprobar a quien la central marca inviable. |
| **`montoSugerido == 0`** (no lo reconoce como sujeto de crédito) | Tope `conditional` + red flag `danger`: los EEFF pueden sostener la operación, pero la aprobación queda a criterio del analista. |

> ⚠️ **Importante:** `montoSugerido` distingue `null` (no hubo consulta → sin
> señal) de `0` (la central no avala ningún monto → cap `conditional` + red
> flag). Antes `0` era **eliminatorio** y recortaba el monto aprobado a 0; se
> relajó porque la central suele ser conservadora frente a los EEFF reales del
> cliente — la señal se conserva, el veto automático no.

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
    "paymentCapacity": { "score": 32, "weight": 32, "status": "comfortable" },
    "termCoherence": { "score": 0, "weight": 8, "status": "incoherent" },
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
| **Realizar estudio** (análisis) | Corre las dimensiones habilitadas sobre DataCrédito; Dim 6 contrasta PDF↔DataCrédito; graba `scoringConfigurationId`; construye `viabilityConditions`. |

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
  vector de comportamiento (§4.7). ✅
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
todo estudio (PN y PJ) en estado `pendingFinancialStatements`. Ver §4.10 para el
comportamiento consolidado del modelo con PN.

⚠️ **Referencia de ingreso PN (implementado).** El mapper de Experian extrae
`endeudamiento.ingreso` → `reportedIncome` y `endeudamiento.porcentajeCuotaVsIngreso`
→ `quotaToIncomePct` (solo PN; null en PJ), persistidos en
`customer_risk_snapshots` (migración `20260718040000_add_reported_income_pn`,
staging+prod) y propagados al motor vía `CentralRiskInput`. Se usan como
**alerta-referencia** en la Capacidad de pago (§4.2), sin alterar el ratio ni el
veredicto: sustituyen el contraste de Veracidad que en PN no es posible.

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
**graduada por severidad × recencia** hasta −0.40 (ver §4.7); −0.15 si el cupo
solicitado supera el `montoSugerido` (over-ask). Resultado `clamp(0,1)`. Las
bandas son constantes en `scoring.constants.ts` (`SCORE_BANDS`), no
parametrizables por empresa (si el proveedor cambia la escala, se ajusta en un
solo lugar). Si no hay `score`, cae al `nivel` como respaldo.

### Salvedad de la fuente (para que el cliente decida)
El resultado declara con qué se calculó:
- `summary.calculationSource`: `'datacredito'` | `'pdf'` | `'none'`.
- `summary.sourceSelection`: `'auto'` | `'manual'` — cómo se eligió la fuente
  (resultados congelados antiguos no traen el campo = `'auto'`).
- `summary.financialsVerified`: `true` solo si corrió sobre DataCrédito, hubo
  PDF para contrastar **y ambos son del mismo período** (con selección manual
  puede haber mismatch de años).
- Alerta `warning` si corrió sobre PDF (cifras auto-reportadas, sin verificar);
  alerta `info` si corrió sobre DataCrédito sin PDF (sin contraste de veracidad).
  Con selección manual las salvedades son específicas (ver abajo).

### Selección manual de la fuente (`POST /:id/perform`, body `{ source }`)

**Motivación (2026-07-25):** los EEFF que la central reporta para algunas
empresas vienen casi vacíos — caso real: casi todos los rubros en `"-"`, total
activo `0` pero patrimonio `105.400` (miles) — y con la regla automática esos
datos "oficiales" gobiernan el cálculo y el estudio sale no viable
injustamente. El usuario ve ambas fuentes en el step2 y decide.

- `source` (opcional): `'datacredito'` | `'pdf_upload'` — los **mismos códigos**
  que expone el step2 en `sources[].source`. Omitido → regla automática.
  DTO: [`perform-study.dto.ts`](../src/credit-studies/dto/perform-study.dto.ts).
- **400** si la fuente forzada no tiene análisis congelado en el estudio.
- El motor recibe `sourceOverride` y lo declara en `summary.sourceSelection:
  'manual'`. Los pesos, dimensiones y reglas eliminatorias NO cambian: solo
  cambia de qué análisis salen los indicadores.
- **Forzar PDF con central del mismo año:** el contraste de veracidad (Dim 6)
  **se mantiene** (compara PDF↔central igual); `financialsVerified: false`;
  `warning` específica ("por selección manual del usuario, aunque la central
  reporta EEFF del mismo período").
- **Forzar la central con años distintos** (auto habría elegido el PDF): la
  Veracidad queda en `period_mismatch` (igual que siempre),
  `financialsVerified: false`, `info` específica con ambos años.
- Cinturón en el motor: si la fuente forzada no trae cifras, cae a la regla
  automática (inalcanzable vía API por la validación 400 del servicio).

### Reset de estudio por soporte (`POST /admin/credit-studies/:id/reset`)

**Motivación (2026-07-26):** cuando la extracción del PDF lee mal una cifra y
el estudio ya quedó realizado, llega un ticket. Tras corregir el prompt,
soporte (portal admin, `AdminGuard`) resetea el estudio para que el usuario
re-cargue los EEFF y re-analice **sin nueva consulta al bureau** (el snapshot
de riesgo vigente se reutiliza; cero consumo de bolsa).

- Body: `{ reason }` (obligatorio, queda en auditoría) + `supportTicketId`
  (opcional, **FK real a `support_tickets`**; se valida que exista, que sea de
  la misma empresa del estudio y — si el ticket está vinculado a un estudio —
  que sea EL MISMO que se resetea; 404/400 si no).

> **Tickets con vínculo tipado (2026-07-26, migración
> `20260726140000_support_ticket_typed_relations`, staging + prod):** el viejo
> par polimórfico `relatedEntityType`/`relatedEntityId` (texto libre, sin
> integridad) se reemplazó por FKs reales en `support_tickets`:
> `credit_study_id` y `customer_id`. Regla por área (validada en el servicio):
> `credit_study` exige `creditStudyId` (el `customerId` se deriva del estudio);
> `customer` exige `customerId`; `payment`/`account`/`other` no llevan id extra
> (`companyId` ya ata el ticket). Todo id se valida contra la empresa. El
> listado/detalle de tickets ahora incluye el estudio (con cliente y estado) y
> el cliente resueltos por join, y desde un estudio o cliente se pueden listar
> sus tickets (relaciones inversas `supportTickets`). El catálogo
> `support_related_entity` quedó desactivado.
- **Antes de limpiar** se congela el estado previo COMPLETO en la tabla
  **`credit_study_resets`** (append-only): resultado de viabilidad, status,
  solicitud y los análisis congelados con sus períodos/indicadores/red flags —
  atado al ticket (`support_ticket_id`, ON DELETE SET NULL), al motivo y al
  admin que lo ejecutó (`resetBy`).
- Luego, en la misma transacción: borra los análisis congelados del estudio
  (join + períodos + indicadores; los `AiAnalysis` — log de extracciones — se
  conservan como evidencia), limpia `viability*`/`recommended*`/
  `resolutionDate`/`scoringConfigurationId` y regresa el estado a
  `pendingFinancialStatements`.
- **400** si el estudio está en estado bloqueado (`confirmed`, `rejected`,
  `pendingSignature`, `closed` — `LOCKED_STUDY_STATUSES`, ahora compartido en
  `credit-study-status.constants.ts`): un estudio confirmado/firmado no se
  resetea; eso sería un flujo de anulación aparte.

**Consulta de la auditoría (portal admin):**
- `GET /admin/credit-study-resets` — listado (desc por fecha): empresa, cliente
  y solicitud del estudio con su estado ACTUAL (permite ver si ya se
  re-analizó), ticket (referencia/asunto/descripción), motivo y admin que lo
  ejecutó. NO incluye el snapshot (pesado).
- `GET /admin/credit-study-resets/:id` — detalle: `previousStatus` (del
  snapshot), ticket con estado/prioridad, estado actual del estudio (antes/
  después) y el **snapshot completo** congelado al resetear.

**Cinturones relacionados (mismo cambio):**
- **Re-cargar el PDF REEMPLAZA, no duplica**: `extract-pdf` descongela y borra
  los análisis previos del estudio antes de persistir los nuevos (después de
  que la IA extrajo con éxito, para no perder lo anterior si falla). Antes, una
  re-carga duplicaba las fuentes congeladas y el perform usaba la MÁS VIEJA
  (`.find` sobre la join ordenada asc) — es decir, re-cargar no corregía nada.
- `extract-pdf` ahora rechaza (400) la carga sobre estudios en estado bloqueado.

### Monto aprobado (lo mandan los EEFF; la central es referencia)
- **No** reimplementamos las *recomendaciones de cupo/plazo* con fórmula propia
  (`paymentSuggestions` del modelo viejo sigue fuera de alcance).
- **Sí** producimos un **monto aprobado** = el cupo solicitado acotado al
  **máximo pagable según los EEFF** para el plazo (capacidad de pago mensual ×
  plazo ÷ 30, ver §4.8). El `montoSugerido` de la central NO recorta: es
  referencia y dispara alertas (1.5×/3×). Vive en `recommendedCreditLine` y en
  `approvedCreditLine` del JSON. El plazo aprobado (`recommendedTerm`) refleja
  el plazo solicitado (no lo recalculamos). Igual en PN y PJ.
- **PN se evalúa sobre el PDF, con 6 dimensiones** (todas menos Veracidad) y el
  **ingreso reportado por la central como contraste** de la capacidad de pago
  (§4.10). El caso límite de una PN **sin PDF y sin EEFF de ninguna fuente** (un
  asalariado sin negocio) sí requiere un modelo distinto, pendiente de diseño en
  documento aparte; el flujo actual exige PDF para PN y no llega a ese escenario.

### Archivos
| Archivo | Rol |
|---------|-----|
| [`scoring.constants.ts`](../src/scoring/scoring.constants.ts) | Dimensiones, pesos default, `MIN_WEIGHT`, `SCORE_BANDS`, severidades de mora, labels de categorías. |
| [`scoring.validation.ts`](../src/scoring/scoring.validation.ts) | `validateWeights`, `weightsToColumns`. |
| [`scoring.engine.ts`](../src/scoring/scoring.engine.ts) | `runScoring()` — motor puro sobre las dimensiones habilitadas + eliminatorios + cap + red flags de la central. |
| [`scoring.types.ts`](../src/scoring/scoring.types.ts) | Entrada/salida del motor. |
| [`scoring.service.ts`](../src/scoring/scoring.service.ts) / `.repository.ts` / `.controller.ts` | CRUD de configuración. |
| [`credit-studies.service.ts`](../src/credit-studies/credit-studies.service.ts) | `performStudy()` arma la entrada y corre el motor; `getSteps()` sirve el stepper. |
| [`ai-analyses.service.ts`](../src/ai-analyses/ai-analyses.service.ts) | `analyze()` — informe ejecutivo IA sobre el resultado. |
| [`credit-study-analysis.prompt.ts`](../src/ai/prompts/credit-study-analysis.prompt.ts) | Prompt v2 del informe IA (consciente de PN/PJ, 3 capas de flags, keyFigures). |
| [`credit-study-report.mapper.ts`](../src/credit-studies/pdf/credit-study-report.mapper.ts) + [plantilla](../src/credit-studies/pdf/templates/credit-study-report.template.html) | PDF descargable "Concepto de Viabilidad": espejo del front (veredicto, keyFigures, dimensiones, alertas, central de riesgo — incluye **score de la central con su banda** y las **sugerencias de verificación** —, las **dos capas de red flags** (`pdfReliabilityFlags` "Fiabilidad del Documento" y `centralRiskFlags` "Señales de la Central de Riesgo", agrupadas por severidad como en el front) e informe IA). |

> **Nota de redacción:** los mensajes del motor hablan de "el cliente" (nunca
> "la empresa") cuando se refieren al sujeto analizado, porque aplica igual a PN
> y PJ. "Empresa" se reserva para la empresa usuaria de Creditia y para señales
> exclusivas de PJ (matrícula, liquidación, obligación de reportar EEFF).

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
      → dimensiones habilitadas por la empresa, ponderadas con su config (por tipo PN/PJ)
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
  "recommendedCreditLine": 50000000,     // monto avalado (según EEFF, ver §4.8)
  "recommendedTerm": 40,
  "resolutionDate": "...",
  "result": { /* ScoringResult completo, ver 12.3 */ },
  "aiAnalysis": { ... } | null           // SOLO en step3 (el informe se genera después)
}
```

`GET /:id/steps` es la fuente única del wizard del front:
- **nivel raíz**: `creditStudyId`, `status` (etapa del flujo), `studyDate`,
  `request` (cupo/plazo solicitados).
- **step1**: datos del cliente (con `isLegalEntity` y `personType` legible) +
  el bloque `centralRisk` del último snapshot (score, viabilidad, ingreso,
  endeudamiento, comportamiento, sectores y las **`suggestions`** — el checklist
  de verificación que la central recomienda, ver 4.10).
- **step2**: estados financieros por fuente (`pdf_upload` y/o `datacredito`),
  cada una con sus 2 años crudos, indicadores, ratios y (solo PDF) las
  `reliabilityFlags` — ver `financial-statements-model.md`.
- **step3**: el resultado del análisis (contrato de arriba).

### 12.3 Qué contiene el `result` (ScoringResult)

| Bloque | Qué es |
|--------|--------|
| `summary` | score 0-100, veredicto, fuente del cálculo (`datacredito`/`pdf`), `financialsVerified`, `eliminatoryReason` (si el rechazo fue por regla dura, no por score) |
| `dimensions` | las dimensiones habilitadas: ratio 0-1, peso efectivo, contribución, status, `evaluable` (si no lo es, su peso se redistribuyó) |
| `alerts` | mensajes por dimensión + salvedades de fuente + eliminatorios |
| `approvedCreditLine` | solicitado vs avalado, `suggestedByBureau` (referencia), `cappedByCapacity` (recortado al máximo pagable — en PN acotado por el ingreso, 4.2/4.8) |
| `keyFigures` | cifras clave YA calculadas para mostrar (no re-derivar en el front): capacidad de pago mensual/anual, **pago único al vencimiento** (`paymentAtMaturity`), **capacidad acumulada en el plazo** (`capacityInTerm`), **cobertura del pago** (veces), servicio de deuda, EBITDA, rotaciones (cartera/inventarios/proveedores), **ciclo de caja**, factor de estabilidad |
| `centralRiskFlags` | red flags de la central con `category` + `categoryLabel` (§4.9) |
| `pdfReliabilityFlags` | red flags de fiabilidad del PDF con `category` + `categoryLabel` (§4.9) |
| `reference` | opinión de Experian tal cual: score, montoSugerido, `experianRiskLevel` (PJ), `experianViability` y `experianCollectionRating` (PN) |

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

---

## 13. Guía aplicada: clientes y veredictos (con números)

> Esta sección es para **entender el modelo de punta a punta sin saber de
> código**: una empresa cliente de Creditia estudia a varios clientes distintos
> (datos simulados pero realistas) y se muestra el cálculo completo de cada
> dimensión hasta el veredicto. Todos los casos usan las fórmulas EXACTAS del
> motor (§4). Los casos **A–C son personas jurídicas** (§13.2–13.4); el caso **D
> es una persona natural** (§13.6), que muestra las diferencias de §4.10.

**Supuestos comunes de los tres casos:**

- El cliente estudiado es **persona jurídica**; la consulta a DataCrédito trajo
  estados financieros (fuente de verdad) y la opinión de riesgo de la central.
- El cliente además cargó su **PDF** de estados financieros → hay contraste de
  veracidad.
- La empresa tiene habilitadas **las 7 dimensiones** con los pesos default de
  PJ:

| Dimensión | Peso |
|-----------|-----:|
| Capacidad de pago | 20 |
| Veracidad | 20 |
| Riesgo de la central | 15 |
| Salud financiera | 15 |
| Adecuación del cupo | 12 |
| Exposición del capital | 10 |
| Coherencia de plazos | 8 |
| **Total** | **100** |

*Si la empresa hubiera deshabilitado alguna dimensión opcional, esa fila
simplemente no existiría en el cálculo y los 100 puntos de peso estarían
repartidos entre las habilitadas.*

Todas las cifras van en **millones de pesos (M)**.

> ⚠️ **Vigencia de los escenarios:** A, B y C (13.2–13.4) se escribieron con el
> modelo previo a dos cambios: la fusión de "Adecuación del cupo" en la Dim 2
> (4.4) y el `montoSugerido` como señal en vez de techo (4.8). Los principios y
> la aritmética de cada dimensión ilustran igual, pero los pesos y la lista
> exacta de dimensiones difieren del motor actual. El escenario D (María, 13.6)
> sí está al día con el modelo vigente (ingreso PN + pago único).

### 13.1 Glosario mínimo

| Término | En palabras simples |
|---------|---------------------|
| **EBITDA** | La utilidad que deja la operación del negocio: ingresos menos costos y gastos operativos. La "caja gruesa" antes de deudas e impuestos. |
| **Servicio de deuda** | Lo que el cliente ya paga al año por deudas existentes: obligaciones financieras de corto plazo + gastos financieros (intereses). |
| **Capacidad de pago mensual** | Lo que le queda libre al mes para deuda NUEVA: (EBITDA ajustado − servicio de deuda) ÷ 12. En PN queda acotada por el ingreso disponible de la central (4.2). |
| **Pago único al vencimiento** | El cupo completo, que se paga UNA vez al final del plazo (el crédito comercial no tiene cuotas mensuales). |
| **Capacidad acumulada en el plazo** | Capacidad mensual × (plazo ÷ 30): lo que el cliente junta en los días del plazo para ese pago único. Es también el máximo que Creditia avala. |
| **Rotación de cartera** | Días que tarda en cobrarle a sus propios clientes. |
| **Ciclo de caja** | Días que su dinero está "atrapado" en la operación: días en cobrar + días en bodega − días que le fían sus proveedores. |
| **Score de la central** | Puntaje de DataCrédito Experian (150–950). Más alto = mejor historial crediticio. |
| **Monto sugerido** | El monto que la central avalaría. Es **referencia/señal** (alertas si el pedido lo supera mucho), NO techo del monto (4.8). |

### 13.2 Escenario A — Cliente EXCELENTE: "Alimentos La Sabana S.A.S." ✅

**Pide:** cupo de **$30M a 60 días** → pago único de **$30M al día 60**.

**Sus cifras** (año corriente, según DataCrédito):

| Cifra | Valor |
|-------|------:|
| Ingresos | 2.400 |
| Costo de ventas | 1.680 |
| Gastos de administración / de ventas | 240 / 120 |
| **EBITDA** (2.400 − 1.680 − 240 − 120) | **360** |
| Activo total (corriente) | 1.500 (900) |
| Pasivo total (corriente) | 700 (450) |
| Patrimonio / utilidades retenidas | 800 / 300 |
| Servicio de deuda (60 oblig. CP + 30 gastos fin.) | **90** |
| Rotaciones: cartera / inventarios / proveedores | 45 / 41 / 23 días |
| Central: score / monto sugerido / mora | **745** / **$80M** / sin mora |
| Contraste PDF ↔ central (peor diferencia) | **3%** (utilidad neta) |

**Cálculo dimensión por dimensión:**

1. **Salud financiera** — Z-Altman:
   `1.2×(900−450)/1500 + 1.4×300/1500 + 3.3×360/1500 + 0.6×800/700 + 2400/1500`
   `= 0.36 + 0.28 + 0.79 + 0.69 + 1.60 =` **Z ≈ 3.72 > 3** → zona segura →
   cumplimiento **1.0**.
2. **Capacidad de pago** — EBITDA ajustado = 360 × 1 (zona segura) = 360;
   capacidad anual = 360 − 90 = 270 → **$22.5M/mes** → acumulada en 60 días =
   22.5 × 2 = **$45M**. Cobertura del pago = 45 ÷ 30 = **1.5 ≥ 1.2** → holgada
   → **1.0**.
3. **Coherencia de plazos** — pide 60 días y cobra a 45: cobra ANTES de tener
   que pagarnos → cómodo → **1.0**.
4. **Adecuación del cupo** — techo por capacidad = 22.5 × (60/30) = $45M;
   techo de la central = $80M. Pide $30M: dentro de ambos → **1.0**.
5. **Exposición del capital** — ciclo de caja = 45 + 41 − 23 = 63 días;
   exposición sana = 22.5 × (63/30) = $47.2M. Pide $30M (el 63%) → eficiente →
   **1.0**.
6. **Veracidad** — peor diferencia PDF vs central = 3% < 10% → consistente →
   **1.0**.
7. **Riesgo de la central** — score 745 → banda **Bueno** (700–749) → base
   0.8; sin mora, sector normal, no pide por encima de lo avalado → **0.8**.

| Dimensión | Cumplimiento | × Peso | = Puntos |
|-----------|-------------:|-------:|---------:|
| Capacidad de pago | 1.0 | 20 | 20.0 |
| Veracidad | 1.0 | 20 | 20.0 |
| Riesgo de la central | 0.8 | 15 | 12.0 |
| Salud financiera | 1.0 | 15 | 15.0 |
| Adecuación del cupo | 1.0 | 12 | 12.0 |
| Exposición del capital | 1.0 | 10 | 10.0 |
| Coherencia de plazos | 1.0 | 8 | 8.0 |
| **Score de viabilidad** | | | **97** |

**Veredicto: `approved`** (97 ≥ 75, ninguna eliminatoria, la central no lo
marca en riesgo alto). **Monto aprobado: $30M** — lo pedido, porque respeta el
techo de la central ($80M).

### 13.3 Escenario B — Cliente ACEPTABLE: "Ferretería El Tornillo Ltda." ⚠️

**Pide:** cupo de **$4.5M a 75 días** → pago único de **$4.5M al día 75**.

**Sus cifras:** ingresos 900; costo de ventas 630; gastos 120 + 60 →
**EBITDA = 90**. Activo 800 (corriente 420); pasivo 540 (corriente 320);
patrimonio 260; utilidades retenidas 40. Servicio de deuda = 24 + 12 = **36**.
Rotaciones: cartera **90**, inventarios 60, proveedores 36 días. Central:
score **668**, monto sugerido **$12M**, una mora de 60 días **hace 8 meses**
(desde entonces, al día). Contraste PDF ↔ central: peor diferencia **14%**
(patrimonio).

1. **Salud financiera** — Z ≈ 0.15 + 0.07 + 0.37 + 0.29 + 1.13 = **2.0** →
   zona gris → **0.5**. (Además, su EBITDA solo se creerá al 66%.)
2. **Capacidad de pago** — EBITDA ajustado = 90 × 0.66 = 59.4; capacidad
   anual = 59.4 − 36 = 23.4 → **$1.95M/mes** → acumulada en 75 días = 1.95 ×
   2.5 = **$4.87M**. Cobertura del pago = 4.87 ÷ 4.5 = **1.08**: cubre pero sin
   holgura (entre 1.0 y 1.2) → ajustada → **0.6**.
3. **Coherencia de plazos** — pide 75 días y cobra a 90: paga antes de cobrar,
   pero la brecha es manejable (75 ≥ 63, el 70% de 90) → ajustado → **0.5**.
4. **Adecuación del cupo** — techo por capacidad = 1.95 × 2.5 = $4.87M; techo
   de la central = $12M. Pide $4.5M: dentro de ambos → **1.0**.
5. **Exposición del capital** — ciclo de caja = 90 + 60 − 36 = 114 días;
   exposición sana = 1.95 × 3.8 = $7.4M. Pide $4.5M → eficiente → **1.0**.
6. **Veracidad** — diferencia del 14% (entre 10% y 25%) → discrepante →
   **0.5** + alerta warning ("revisar la consistencia de la información").
7. **Riesgo de la central** — score 668 → banda **Aceptable** → base 0.6. La
   mora de hace 8 meses casi no pesa (la recencia manda: índice ≈ 0.03 →
   penalización ≈ −0.01) → **≈ 0.59** + warning.

| Dimensión | Cumplimiento | × Peso | = Puntos |
|-----------|-------------:|-------:|---------:|
| Capacidad de pago | 0.6 | 20 | 12.0 |
| Veracidad | 0.5 | 20 | 10.0 |
| Riesgo de la central | 0.59 | 15 | 8.8 |
| Salud financiera | 0.5 | 15 | 7.5 |
| Adecuación del cupo | 1.0 | 12 | 12.0 |
| Exposición del capital | 1.0 | 10 | 10.0 |
| Coherencia de plazos | 0.5 | 8 | 4.0 |
| **Score de viabilidad** | | | **64** |

**Veredicto: `conditional`** (40 ≤ 64 < 75). **Monto aprobado: $4.5M** (dentro
del techo). La lectura para la empresa: puede otorgar, **con condiciones** — la
cobertura de la cuota es justa, hay una discrepancia del 14% en patrimonio que
conviene aclarar con el cliente, y su caja queda tensionada porque cobra más
lento de lo que tendría que pagarnos.

### 13.4 Escenario C — Cliente RECHAZADO: "Comercializadora El Atajo S.A.S." ⛔

**Pide:** cupo de **$50M a 30 días**.

**Sus cifras:** ingresos 1.200; costo de ventas 900; gastos 180 + 60 →
**EBITDA = 60**. Activo 1.000 (corriente 380); pasivo 880 (corriente 520);
patrimonio 120; utilidades retenidas **−80** (pérdidas acumuladas). Servicio de
deuda = 90 + 45 = **135**. Rotación de cartera 75 días. Central: score
**470**, monto sugerido **$10M**, saldo en mora vigente **$8.2M**,
endeudamiento del 86%, moras de 30 a 120 días en los **últimos 4 meses**.
Contraste PDF ↔ central: los ingresos del PDF ($1.656M) superan en **+38%** a
los registrados en la central ($1.200M).

1. **Salud financiera** — Z ≈ −0.17 − 0.11 + 0.20 + 0.08 + 1.20 = **1.2 <
   1.8** → zona crítica → **0.0**. (Y su EBITDA solo se cree al 33%.)
2. **Capacidad de pago** — EBITDA ajustado = 60 × 0.33 = 19.8; capacidad
   anual = 19.8 − 135 = **−115.2** → capacidad mensual **−$9.6M**. Su deuda
   actual ya se come toda la utilidad → **REGLA ELIMINATORIA: rechazo
   directo**, sin importar el resto.
3. **Coherencia de plazos** — pide pagar a 30 días cuando cobra a 75 (menos
   del 70%) → tensionado → **0.0**.
4. **Adecuación del cupo** y **5. Exposición del capital** — sin capacidad de
   pago no hay cupo recomendable → **0.0** ambas. (Además pide $50M cuando la
   central avala $10M: 5 veces el techo.)
6. **Veracidad** — diferencia del 38% > 25% → **maquillado** → **0.0** +
   alerta danger ("posible maquillaje de los estados financieros").
7. **Riesgo de la central** — score 470 → banda **Riesgo alto** → base 0.0;
   la mora reciente (índice ≈ 0.30 → −0.12) y el sobre-pedido (−0.15) no
   tienen ya de dónde restar → **0.0**. Red flags: saldo en mora vigente
   (danger), endeudamiento muy alto (danger), mora en el historial (warning),
   puntaje en banda de riesgo alto (warning).

**Score residual: 0. Veredicto: `rejected`**, con el motivo eliminatorio
explícito en el resultado: *"El cliente no cuenta con capacidad de pago: el
servicio de deuda supera el EBITDA ajustado."* Aunque la eliminatoria no
existiera, el score (0 < 40) lo rechazaría igual, y el **cap de la central**
(score < 500 → nunca `approved`) le cerraría la puerta a cualquier aprobación.
El bloque `approvedCreditLine` queda en **$0 con `cappedByCapacity: true`**
(capacidad negativa → nada avalable; el montoSugerido de $10M queda solo como
referencia), aunque es irrelevante frente al rechazo.

### 13.5 Los tres casos lado a lado

| | A — La Sabana ✅ | B — El Tornillo ⚠️ | C — El Atajo ⛔ |
|---|---:|---:|---:|
| **Score** | 97 | 64 | 0 (eliminatorio) |
| **Veredicto** | Aprobado | Con condiciones | Rechazado |
| Cobertura del pago al vencimiento | 1.5× | 1.08× | Negativa |
| Z-Altman (zona) | 3.7 (segura) | 2.0 (gris) | 1.2 (crítica) |
| Diferencia PDF vs central | 3% | 14% | 38% (maquillado) |
| Score de la central | 745 | 668 | 470 |
| Pide vs central avala | 30 de 80 | 4.5 de 12 | 50 de 10 |
| **Monto aprobado** | $30M | $4.5M | — (rechazado) |

**Las moralejas del modelo:**

1. **Ninguna cifra buena compensa una eliminatoria.** El Atajo habría sido
   rechazado solo por su capacidad de pago negativa, sin mirar nada más.
2. **El estudio evalúa la SOLICITUD, no solo al cliente.** Si La Sabana hubiera
   pedido $100M a 30 días, su cobertura y sus techos se rompen y el veredicto
   cambia — el mismo negocio puntúa distinto según lo que pida.
3. **La zona gris castiga dos veces, por diseño.** A El Tornillo le bajó la
   Dim 1 y además le descontó el 34% del EBITDA en la Dim 2: a un negocio
   frágil se le cree menos caja.
4. **La central siempre tiene la última palabra:** pone el techo del monto, un
   cap al veredicto, y es una dimensión propia. Un PDF bien presentado jamás
   aprueba a quien la central marca como riesgo alto.
5. **La mora vieja no persigue al cliente.** La mora de El Tornillo (hace 8
   meses, ya normalizada) le costó centésimas; la misma mora reciente, como la
   de El Atajo, pesa mucho más.

### 13.6 Escenario D — Persona Natural: "María Gómez (comerciante)" ⚠️

> Los tres casos anteriores son personas jurídicas. Este muestra cómo cambia el
> cálculo para una **persona natural** (§4.10): 6 dimensiones en vez de 7 (sin
> Veracidad), cifras del **PDF** (la central no reporta EEFF de PN) y el **ingreso
> certificado por la central GOBERNANDO la capacidad de pago** (4.2).

**Supuestos:** cliente **persona natural** con actividad comercial; cargó su PDF
de EEFF. La empresa tiene los **pesos default PN** (§5.2): Capacidad 38, Riesgo
central 25, Salud 19, Exposición 10, Coherencia 8, Veracidad **0**. Cifras en
millones (M).

**Pide:** cupo de **$4M a 60 días** → pago único de **$4M al día 60**.

**Sus cifras** (del PDF, única fuente para PN):

| Cifra | Valor |
|-------|------:|
| Ingresos / costo de ventas / gastos | 180 / 120 / 24 |
| **EBITDA** (180 − 120 − 24) | **36** |
| Activo total (corriente) | 90 (60) |
| Pasivo total (corriente) | 40 (25) |
| Patrimonio / utilidades retenidas | 50 / 20 |
| Servicio de deuda (6 oblig. CP + 2 gastos fin.) | **8** |
| Rotaciones: cartera / inventarios / proveedores | 30 / 40 / 25 días |
| **Central (PN):** score / monto sugerido / mora | **690** / **$10M** / sin mora |
| **Central (PN):** ingreso reportado / % cuota-ingreso | **$2M/mes** / **40%** |

**Cálculo dimensión por dimensión:**

1. **Salud financiera** — Z-Altman:
   `1.2×(60−25)/90 + 1.4×20/90 + 3.3×36/90 + 0.6×50/40 + 180/90`
   `= 0.47 + 0.31 + 1.32 + 0.75 + 2.0 =` **Z ≈ 4.85 > 3** → zona segura → **1.0**.
2. **Capacidad de pago** — según el PDF: EBITDA ajustado = 36 × 1 = 36;
   capacidad anual = 36 − 8 = 28 → **$2.33M/mes**. Pero María es PN y **el
   ingreso de la central manda** (4.2): ingreso disponible = 2 × (1 − 0.40) =
   **$1.2M/mes** → capacidad **efectiva** = min(2.33, 1.2) = **$1.2M/mes** →
   acumulada en 60 días = 1.2 × 2 = **$2.4M**. Cobertura del pago = 2.4 ÷ 4 =
   **0.6** (< 1.0) → insuficiente → **0.0** (danger).
   Alertas que acompañan:
   - `info`: la capacidad se limitó al ingreso disponible según la central
     ($1.2M = $2M menos el 40% ya comprometido); el PDF implicaba $2.33M.
   - `danger`: la capacidad que implica el PDF ($2.33M/mes) **supera el ingreso
     que reporta la central** ($2M/mes) → *no puede destinar a pagar más de lo
     que gana* → revisar la veracidad del PDF.
3. **Coherencia de plazos** — pide 60 días y cobra a 30 → cobra antes de
   pagarnos → cómodo → **1.0**.
4. **Exposición del capital** — ciclo de caja = 30 + 40 − 25 = 45 días;
   exposición sana = 1.2 × (45/30) = **$1.8M** (con la capacidad efectiva).
   Pide $4M (el 222%, > 1.5) → excesiva → **0.0** (danger).
5. **Veracidad** — **no aplica en PN** (`not_evaluable`, peso 0): la central no
   tiene EEFF de PN con qué contrastar. Su función la cumple la referencia de
   ingreso del punto 2.
6. **Riesgo de la central** — score 690 → banda **Aceptable** (650–699) → base
   0.6; sin mora, sector normal → **0.6**.

| Dimensión | Cumplimiento | × Peso | = Puntos |
|-----------|-------------:|-------:|---------:|
| Capacidad de pago | 0.0 | 38 | 0.0 |
| Riesgo de la central | 0.6 | 25 | 15.0 |
| Salud financiera | 1.0 | 19 | 19.0 |
| Exposición del capital | 0.0 | 10 | 0.0 |
| Coherencia de plazos | 1.0 | 8 | 8.0 |
| Veracidad | — (no aplica) | 0 | 0.0 |
| **Score de viabilidad** | | | **42.0** |

**Veredicto: `conditional`** (40 ≤ 42 < 75, apenas). **Monto aprobado: $2.4M**
(máximo pagable con la capacidad efectiva: $1.2M/mes × 2 meses;
`cappedByCapacity: true` — pidió $4M). `calculationSource: 'pdf'`,
`financialsVerified: false` → alerta `warning` de cifras auto-reportadas. La
lectura para la empresa: el negocio de María luce sano en el papel (salud 1.0),
pero su **ingreso verificado no alcanza para el pago pedido en ese plazo** —
Creditia solo avala lo que el sueldo real acumula en los días del plazo, y deja
la señal de que el PDF implica más capacidad de la que ella gana.

> **Moraleja PN:** el modelo no inventa una lógica nueva para persona natural —
> corre las mismas dimensiones sobre el PDF, apaga la Veracidad y pone el
> **ingreso certificado por la central a gobernar la capacidad de pago**. Antes
> de esta regla, este mismo caso puntuaba 70.8 y se avalaban los $4M completos
> con un simple warning; un PDF "optimista" ya no puede avalar montos que el
> sueldo real no soporta.
