# Cómo decide Creditia si un cliente es viable

### Guía para el equipo comercial — qué pasa tras bambalinas

> **Para qué sirve este documento.** Explica, en lenguaje de negocio y sin
> tecnicismos, todo lo que ocurre entre el momento en que un usuario pide un
> estudio de crédito y el momento en que aparece el veredicto en pantalla. Está
> pensado para que cualquier persona del equipo comercial pueda contarlo en una
> demo, defenderlo frente a un prospecto y responder las objeciones típicas.
>
> No hace falta saber de contabilidad ni de programación: cada término se explica
> la primera vez que aparece, y al final hay un glosario. La versión técnica del
> mismo modelo, para el equipo de producto y desarrollo, vive en
> `credit-study-scoring-v2.md`.
>
> ⚠️ **Uso interno.** Este documento trae los umbrales, los pesos y las reglas
> exactas con las que Creditia decide. Es material de preparación del equipo
> comercial — **no se entrega al cliente ni al prospecto**: quien conoce los
> cortes exactos puede aprender a acomodar un balance para pasarlos. Para el
> cliente están la demo, el informe ejecutivo del estudio y el material de
> marketing.

---

## 1. Qué hace Creditia, en una frase

Una empresa quiere venderle a crédito a un cliente suyo. Nos dice **cuánto** le
quiere prestar (el cupo) y **a cuántos días** (el plazo). Creditia consulta la
central de riesgo, lee los estados financieros del cliente y responde tres
preguntas:

> **¿Puede pagar? ¿Ha querido pagar? ¿Está diciendo la verdad?**

El resultado es un **puntaje de 0 a 100**, un **veredicto** (aprobado / aprobado
con condiciones / rechazado), un **monto que Creditia avala** y una lista de
**alertas** que explican el porqué.

**Lo importante para vender:** Creditia no evalúa solo al cliente, evalúa **la
operación**. El mismo negocio, pidiendo $30 millones a 60 días o $100 millones a
30 días, obtiene veredictos distintos. Eso es exactamente lo que un analista
humano haría — solo que en minutos y con la misma vara para todos.

---

## 2. El recorrido completo: cuatro pasos

| Paso | Qué ocurre | Qué ve el usuario |
|------|------------|-------------------|
| **1. Consulta a la central** | Se consulta DataCrédito Experian con la cédula o el NIT. Llega el comportamiento de pago, el puntaje, el nivel de riesgo, el endeudamiento, el estado legal de la empresa y —si es persona jurídica— sus estados financieros reportados. | Se crea el estudio en estado *"Pendiente Estados Financieros"*. **Consume 1 consulta de la bolsa.** |
| **2. Carga de estados financieros** | El usuario sube el PDF de los estados financieros del cliente. Una IA los lee, extrae las cifras y levanta alertas si el documento no cuadra consigo mismo. | El estudio pasa a *"Pendiente Análisis"*. Se ven las cifras de **ambas fuentes** lado a lado. |
| **3. El análisis** | El motor evalúa las dimensiones, aplica las reglas que no se negocian y produce puntaje, veredicto, monto avalado y alertas. | *"Estudio Realizado"*: el resultado completo. **No consume consultas.** |
| **4. Informe ejecutivo** | Una IA redacta el concepto en prosa, a partir de las mismas cifras del análisis (no inventa nada nuevo). | Un informe descargable en PDF, listo para el comité de crédito. |

> **Dato para objeciones de precio:** solo el paso 1 consume bolsa. Volver a
> analizar el mismo estudio, corregir el PDF y re-analizar, o pedirle a soporte
> que reinicie el estudio **no cuesta consultas adicionales**.

---

## 3. De dónde salen las cifras (y por qué eso lo cambia todo)

Hay dos fuentes posibles de estados financieros, y no valen lo mismo:

| Fuente | Quién la produce | Qué tan confiable es |
|--------|------------------|----------------------|
| **DataCrédito** | La central, con lo que la propia empresa está **obligada** a reportar a las entidades | Alta: es oficial y **no es maquillable** |
| **PDF del cliente** | El cliente lo entrega | Menor: es **auto-reportado**; puede estar inflado |

**La regla:** manda la central. Si la central tiene los estados financieros del
cliente y son del **mismo año** que el PDF, el cálculo corre sobre las cifras de
la central y el PDF se usa para **contrastar** (ahí nace la dimensión de
Veracidad, §4.5).

**Las excepciones, y cómo explicarlas:**

- **El cliente no tiene estados financieros en la central** (típico en persona
  natural, y también en empresas pequeñas): se calcula sobre el PDF y el
  resultado lo declara con una advertencia de "cifras auto-reportadas, sin
  verificar".
- **El PDF trae un año más nuevo que el que la central alcanzó a publicar**
  (pasa entre enero y marzo, porque el plazo para reportar aún no ha vencido):
  se calcula sobre el PDF —es la información más fresca— y se avisa que no se
  pudo verificar.
- **La central reporta las cifras incompletas** (a veces llegan casi todos los
  rubros vacíos): el usuario puede **elegir manualmente** calcular sobre el PDF.
  El resultado deja constancia de que la fuente la eligió una persona.

> **El principio que nunca se rompe:** el resultado **siempre declara con qué
> cifras se calculó y si están verificadas**. Creditia nunca presenta como
> verificado algo que no lo está. Ese es un argumento de venta, no una
> limitación.

---

## 4. Las seis preguntas que responde el análisis

Cada "dimensión" es una pregunta concreta sobre el cliente. El motor la responde
con una nota de **0 a 1** (0 = incumple del todo, 1 = cumple del todo) y esa nota
se multiplica por el **peso** que la empresa le asignó. La suma de todas da el
puntaje de 0 a 100.

| Dimensión | La pregunta que responde | Peso por defecto: empresa | Peso por defecto: persona |
|-----------|--------------------------|--------------------------:|--------------------------:|
| **Capacidad de pago** | ¿Le alcanza la caja para pagar lo que pide, en el plazo que pide? | 32 | 38 |
| **Veracidad** | ¿Sus cifras coinciden con las que reportó a la central? | 20 | — *(no aplica)* |
| **Riesgo de la central** | ¿Cómo ha pagado históricamente en todo el sistema? | 15 | 25 |
| **Salud financiera** | ¿El negocio es sólido o muestra señales de quiebra? | 15 | 19 |
| **Exposición del capital** | ¿El crédito inmoviliza más plata de la razonable? | 10 | 10 |
| **Coherencia de plazos** | ¿El plazo que pide calza con la velocidad a la que él cobra? | 8 | 8 |
| | | **100** | **100** |

**Cada empresa configura sus propios pesos**, y por separado para personas
naturales y jurídicas. Puede también **apagar** las dimensiones que no le
interesen — salvo dos: *Capacidad de pago* y *Riesgo de la central* son
obligatorias, porque sin ellas el estudio deja de ser un estudio de crédito.

### 4.1 Capacidad de pago — la dimensión que más pesa

**La pregunta:** después de atender las deudas que ya tiene, ¿le queda caja
suficiente para pagarnos?

**Cómo se calcula, en cristiano:**

1. Se mide cuánta plata deja la **operación pura** del negocio en el año (sus
   ingresos menos sus costos y gastos operativos). A eso el mundo financiero le
   dice **EBITDA**.
2. Esa utilidad se **descuenta según qué tan sólido sea el negocio**: a una
   empresa en zona de riesgo no se le cree el 100% de su utilidad como caja
   disponible (ver 4.4).
3. Se le resta lo que **ya paga** por las deudas que tiene hoy. Lo que queda es
   la plata realmente libre para asumir deuda nueva.
4. Se divide entre los meses del período para llegar a la **capacidad mensual**.
5. Se calcula cuánto **acumula esa capacidad durante los días del plazo**
   pedido. Ejemplo: $5 millones al mes, a 60 días, acumula $10 millones.
6. Se compara contra el **pago único al vencimiento**.

> **Ojo con esto, que es diferenciador:** el crédito comercial **no tiene
> cuotas**. El cliente paga TODO el cupo, UNA vez, el día del vencimiento. Por
> eso Creditia no habla de "cuota mensual" en ninguna parte: mide cuánta plata
> junta el cliente en esos días contra lo que tiene que pagar ese día.

| Cuántas veces alcanza | Lectura | Nota |
|-----------------------|---------|-----:|
| 1.2 o más (le sobra 20% o más) | Holgada | **1.0** |
| Entre 1.0 y 1.2 | Cubre, pero justo | **0.6** |
| Menos de 1.0 | No alcanza | **0.0** |

### 4.2 Riesgo de la central — la opinión de un tercero

**La pregunta:** ¿qué opina DataCrédito del comportamiento de este cliente?

Es la mirada de un tercero independiente sobre algo que los estados financieros
**no muestran**: cómo ha pagado sus obligaciones en todo el sistema financiero.
La base es el **puntaje de la central** (escala de 150 a 950):

| Puntaje | Banda | Nota base |
|---------|-------|----------:|
| 750 o más | Excelente | 1.0 |
| 700 – 749 | Bueno | 0.8 |
| 650 – 699 | Aceptable | 0.6 |
| 500 – 649 | Regular | 0.4 |
| Menos de 500 | Riesgo alto | 0.0 |

*(Referencia de mercado: el promedio colombiano ronda los 630 y el umbral de
"buen puntaje" son 700.)*

A esa base se le descuenta si el cliente opera en un **sector de alto riesgo** y
si tiene **mora**. La mora no se castiga como un simple sí/no:

> **La mora vieja no persigue al cliente.** Se pondera por **gravedad** (no es lo
> mismo 30 días que cartera castigada) y por **qué tan reciente** es. Una mora
> severa hace dos meses castiga fuerte; la misma mora hace más de un año,
> seguida de meses al día, casi no pesa. Es un argumento potente frente a
> clientes que se quejan de que "la central no perdona".

### 4.3 Veracidad — el detector de estados financieros maquillados

**La pregunta:** ¿las cifras que el cliente entregó coinciden con las que él
mismo le reportó a la central?

Se comparan cinco cifras gruesas del **mismo año** en ambas fuentes: ingresos,
activo total, pasivo total, patrimonio y utilidad neta.

| Peor diferencia encontrada | Lectura | Nota |
|----------------------------|---------|-----:|
| Menos del 10% | Consistente | **1.0** |
| Entre 10% y 25% | Discrepante — conviene aclarar | **0.5** |
| Más del 25% | **Posible maquillaje** | **0.0** + alerta roja |

Dos cosas que hay que saber explicar:

- **Un maquillaje no elimina el estudio automáticamente**, pero deja la dimensión
  en cero (son 20 puntos de 100 que se pierden de golpe) y genera una alerta roja
  bien visible. La decisión final sigue siendo del analista.
- **Si no hay con qué contrastar, la empresa igual pierde esos puntos.** Suena
  duro, y es intencional: una persona jurídica **está obligada** a reportar sus
  estados financieros. Que no aparezcan en la central no es neutral — significa
  que nadie puede verificar lo que entregó.

### 4.4 Salud financiera — el semáforo de solidez

**La pregunta:** ¿este negocio es estructuralmente sólido o muestra señales de
que podría quebrar?

Se usa el **Z-Score de Altman**, un método clásico de la banca (creado en 1968 y
vigente hoy) que combina cinco señales del negocio en un solo número: cuánto
colchón de corto plazo tiene, cuánta utilidad ha acumulado en su vida, cuánta
utilidad genera hoy, cuánto patrimonio respalda su deuda y cuántas ventas
produce por cada peso invertido.

| Resultado | Zona | Nota | Lectura |
|-----------|------|-----:|---------|
| Más de 3.0 | Segura | **1.0** | Indicadores sólidos |
| Entre 1.8 y 3.0 | Gris | **0.5** | Monitoreo recomendado |
| Menos de 1.8 | Crítica | **0.0** | Alta probabilidad de incumplimiento |

> **Una mala salud financiera castiga dos veces, por diseño.** Además de bajar
> esta dimensión, **descuenta la utilidad** que se le cree al cliente en la
> Capacidad de pago: a un negocio en zona gris se le reconoce el 66% de su
> EBITDA, y a uno en zona crítica solo el 33%. Es prudencia deliberada, no un
> error de cálculo.

### 4.5 Exposición del capital — cuánta plata queda quieta

**La pregunta:** ¿cuánto capital del prestamista queda inmovilizado, y por cuánto
tiempo, frente a lo razonable para la operación de ese cliente?

El crédito comercial no cobra intereses: el costo real para quien presta es
**tener la plata quieta**. Se calcula el **ciclo de caja** del cliente (los días
que su dinero está atrapado en la operación: lo que tarda en cobrar + lo que la
mercancía pasa en bodega − lo que le fían sus proveedores) y se compara el cupo
pedido contra lo que su operación puede absorber sin atascarse.

### 4.6 Coherencia de plazos — el calce con su cobranza

**La pregunta:** si el cliente cobra a 90 días y nos pide pagar a 30, tendrá que
pagarnos **antes** de recibir la plata de sus propios clientes. Esa brecha la
financia de su bolsillo.

> **Cuidado con cómo se cuenta esta dimensión.** No mide riesgo de impago para
> quien presta — que nos paguen rápido es *más* seguro, no menos. Mide **tensión
> de caja del cliente**: una brecha grande puede terminar en pago tardío si él no
> tiene colchón. Nunca la presentes como "riesgo de incumplimiento".

---

## 5. Del puntaje al veredicto

```
nota de la dimensión (0 a 1)  ×  peso configurado  =  puntos
suma de todos los puntos                           =  puntaje de viabilidad (0 a 100)
```

| Puntaje | Veredicto |
|---------|-----------|
| 75 o más | **Aprobado** |
| Entre 40 y 75 | **Aprobado con condiciones** |
| Menos de 40 | **Rechazado** |

Estos tres cortes son **fijos**: la empresa configura los pesos, no los umbrales.
Así, dos empresas con prioridades distintas pueden pesar diferente las
dimensiones, pero "aprobado" significa lo mismo para todos.

### 5.1 Las reglas que ningún puntaje salva

Hay dos situaciones en las que el estudio se **rechaza directo**, sin importar
que el puntaje sea excelente:

| Situación | Por qué |
|-----------|---------|
| **Matrícula mercantil cancelada** o empresa **en liquidación** | No es sujeto de crédito. Punto. |
| **Capacidad de pago igual o menor a cero** | Lo que ya paga en deudas se come toda su utilidad: no hay de dónde pagar algo nuevo. |

Y hay dos señales de la central que **topan el veredicto** en "aprobado con
condiciones" (nunca fuerzan un rechazo, pero impiden una aprobación automática):

| Señal | Efecto |
|-------|--------|
| La central marca al cliente en **riesgo alto** | Un PDF auto-reportado no puede aprobar a quien la central considera inviable. |
| La central **no avala ningún monto** (monto sugerido en $0) | Los estados financieros pueden sostener la operación, pero la aprobación queda a criterio del analista. |

> Estas reglas son **política de Creditia** y aplican siempre, incluso si la
> empresa apagó las dimensiones relacionadas. Es lo que garantiza un piso mínimo
> de prudencia en toda la plataforma.

### 5.2 Qué configura cada empresa y qué no

Este suele ser el punto que cierra la venta con clientes que ya tienen política
de crédito escrita: **el modelo se adapta a su política, no al revés** — pero no
tanto como para que "aprobado" signifique cosas distintas en cada empresa.

| Lo que la empresa decide | Lo que no se toca |
|--------------------------|-------------------|
| **Qué dimensiones usa**: puede apagar las cuatro opcionales | *Capacidad de pago* y *Riesgo de la central* son obligatorias |
| **Cuánto pesa cada una**: reparte 100 puntos entre las que habilitó | Los cortes del veredicto: 75 y 40 |
| **Configuración separada** para personas naturales y para empresas | Las reglas eliminatorias y los topes de la central (§5.1) |

Dos detalles que conviene tener en la punta de la lengua:

- **Ninguna dimensión activa puede pesar menos de 5 puntos.** Si a la empresa una
  dimensión no le importa, lo correcto es **apagarla**, no dejarla con un peso
  simbólico que aparente rigor sin aportarlo.
- **Cambiar la configuración no reescribe la historia.** Cada versión de pesos se
  guarda aparte, y cada estudio queda amarrado a la que estaba vigente el día que
  se analizó. Un concepto emitido hace seis meses se audita tal como se firmó:
  con qué pesos, con qué cifras y con qué fuente se decidió.

> **Cómo se cuenta ante una junta o una revisoría fiscal:** *"Ustedes definen la
> política; nosotros la aplicamos igual a todos los clientes, todos los días, y
> dejamos constancia. Si mañana cambian la política, los conceptos ya emitidos no
> se mueven — se auditan con las reglas que tenían ese día."*

---

## 6. El monto que Creditia avala

Además del veredicto, el estudio dice **cuánto** avala Creditia:

```
monto avalado = lo que el cliente pidió,
                acotado a lo que su capacidad de pago acumula en el plazo
```

Si pide más de lo que su caja junta en esos días, el monto se recorta y se avisa.

**El monto sugerido por la central NO recorta.** Esto hay que saber defenderlo,
porque genera preguntas:

> La central suele ser **muy conservadora**. Nos hemos encontrado clientes cuyo
> analista financiero, con los estados financieros y el comportamiento a la
> vista, avala $50 millones — y la central sugiere $20 millones. Si Creditia
> usara ese número como techo, arrastraría el mismo problema y castigaría a
> clientes buenos sin razón financiera.
>
> Por eso: **el monto lo mandan los estados financieros; la central aporta
> señal.** Si el cliente pide más de 1.5 veces lo sugerido, salta una alerta
> amarilla; más de 3 veces, una alerta roja. Informan al analista, no deciden
> por él.

---

## 7. Las alertas: tres familias que no se mezclan

El resultado trae tres tipos de señales, y conviene distinguirlas porque
responden preguntas distintas:

| Familia | Qué audita | Ejemplo |
|---------|------------|---------|
| **Fiabilidad del documento** | El PDF **contra sí mismo**: lo detecta la IA al leerlo | "El balance no cuadra"; "hay transacciones con socios"; "el documento es una foto escaneada, las cifras se leyeron por reconocimiento visual" |
| **Señales de la central** | Lo que reporta DataCrédito, independiente del PDF | "Saldo en mora vigente"; "endeudamiento del 86%"; "puntaje en banda de riesgo alto"; "matrícula cancelada" |
| **Alertas del análisis** | El resultado de las dimensiones y las salvedades de fuente | "La capacidad de pago no alcanza"; "el cupo se recortó al máximo pagable"; "cifras auto-reportadas, sin verificar" |

Cada alerta viene con severidad (informativa, amarilla o roja) y con una
categoría legible, para que el usuario entienda de un vistazo de dónde viene.

---

## 8. Persona natural: qué cambia

Cuando el cliente estudiado es una **persona** y no una empresa, el motor es el
mismo pero con dos diferencias importantes:

1. **Las cifras salen siempre del PDF**, porque la central no reporta estados
   financieros de personas naturales.
2. **El ingreso certificado por la central manda.** La central sí reporta cuánto
   gana la persona al mes y qué porcentaje de ese ingreso ya tiene comprometido
   en cuotas. Ese dato **acota la capacidad de pago**:

```
ingreso disponible = ingreso reportado × (1 − % ya comprometido)
capacidad real     = la menor entre lo que dicen los estados financieros
                     y ese ingreso disponible
```

> **Por qué importa:** en una persona natural no hay forma de detectar maquillaje
> contrastando balances. Pero el ingreso certificado sí es un dato verificado, y
> hace de contrapeso: **un PDF optimista ya no puede avalar montos que el sueldo
> real no soporta**. Si además los estados financieros implican una capacidad
> mayor a lo que la persona gana, salta una alerta roja — nadie puede destinar a
> pagar más de lo que ingresa.

La dimensión de Veracidad simplemente **no existe** para personas naturales: en
lugar de repartir sus puntos artificialmente, los pesos por defecto ya vienen
distribuidos entre las cinco dimensiones que sí aplican.

---

## 9. Cuatro clientes, cuatro veredictos

Los casos que siguen usan las fórmulas reales del motor, con cifras simuladas
pero realistas. Todo va en **millones de pesos**. Los tres primeros son empresas;
el cuarto es una persona natural.

### Caso A — "Alimentos La Sabana S.A.S." ✅ APROBADO

**Pide:** $30 millones a 60 días.

| Su situación | |
|---|---:|
| Utilidad de la operación (EBITDA) | 360 |
| Lo que ya paga en deudas al año | 90 |
| Días que tarda en cobrarle a sus clientes | 45 |
| Puntaje en la central | 745 |
| Monto sugerido por la central | 80 |
| Diferencia entre su PDF y la central | 3% |

**El análisis, paso a paso:**

- **Salud financiera** → zona segura. Negocio sólido. → **1.0**
- **Capacidad de pago** → le quedan libres $22.5 millones al mes. En 60 días
  acumula $45 millones para pagar $30 millones: cubre 1.5 veces. → **1.0**
- **Coherencia de plazos** → cobra a 45 días y nos paga a 60: cobra antes de
  pagarnos, su caja no sufre. → **1.0**
- **Exposición del capital** → su ciclo de caja soporta hasta $47 millones; pide
  $30. → **1.0**
- **Veracidad** → sus cifras coinciden con la central (3% de diferencia). → **1.0**
- **Riesgo de la central** → 745 puntos, banda "Bueno", sin mora. → **0.8**

**Puntaje: 97 → APROBADO. Monto avalado: los $30 millones que pidió**, porque
caben de sobra en lo que su caja acumula en el plazo ($45 millones). El monto
sugerido por la central ($80 millones) queda solo como referencia.

**Cómo se lo cuentas al cliente:** despache tranquilo. El único punto de atención
es que su puntaje en la central es bueno pero no excelente — nada que cambie la
decisión. De hecho, su caja soporta hasta $45 millones en ese plazo: si el
cliente pide más adelante, hay margen.

### Caso B — "Ferretería El Tornillo Ltda." ⚠️ APROBADO CON CONDICIONES

**Pide:** $4.5 millones a 75 días.

| Su situación | |
|---|---:|
| Utilidad de la operación (EBITDA) | 90 |
| Lo que ya paga en deudas al año | 36 |
| Días que tarda en cobrarle a sus clientes | 90 |
| Puntaje en la central | 668 |
| Mora | una de 60 días, **hace 8 meses** (desde entonces, al día) |
| Diferencia entre su PDF y la central | 14% en patrimonio |

**El análisis, paso a paso:**

- **Salud financiera** → zona gris. Se le cree solo el 66% de su utilidad. → **0.5**
- **Capacidad de pago** → con ese descuento le quedan $1.95 millones al mes. En
  75 días acumula $4.87 millones para pagar $4.5: cubre 1.08 veces, **muy
  justo**. → **0.6**
- **Coherencia de plazos** → cobra a 90 días y nos paga a 75: tiene que pagarnos
  antes de cobrar, pero la brecha es manejable. → **0.5**
- **Exposición del capital** → dentro de lo razonable. → **1.0**
- **Veracidad** → 14% de diferencia en patrimonio: **conviene aclararlo con el
  cliente**. → **0.5**
- **Riesgo de la central** → 668 puntos, banda "Aceptable". La mora de hace 8
  meses casi no pesa. → **0.59**

**Puntaje: ≈60 → APROBADO CON CONDICIONES. Monto avalado: los $4.5 millones.**

**Cómo se lo cuentas al cliente:** puede otorgar el crédito, pero con los ojos
abiertos — la cobertura del pago es apenas de 1.08 veces (cualquier tropiezo lo
deja corto), hay una discrepancia del 14% en patrimonio que vale la pena aclarar,
y su caja queda tensionada porque cobra más lento de lo que tendría que pagarnos.

### Caso C — "Comercializadora El Atajo S.A.S." ⛔ RECHAZADO

**Pide:** $50 millones a 30 días.

| Su situación | |
|---|---:|
| Utilidad de la operación (EBITDA) | 60 |
| Lo que ya paga en deudas al año | **135** |
| Pérdidas acumuladas | sí (−80) |
| Puntaje en la central | 470 |
| Saldo actualmente en mora | 8.2 |
| Endeudamiento | 86% |
| Mora | de 30 a 120 días, en los **últimos 4 meses** |
| Diferencia entre su PDF y la central | **+38% en ingresos** |

**El análisis:**

- **Salud financiera** → zona crítica. Solo se le cree el 33% de su utilidad. → **0.0**
- **Capacidad de pago** → con ese descuento su utilidad baja a $19.8 millones,
  pero **ya paga $135 millones al año en deudas**. La capacidad da **negativa**.
  → **REGLA ELIMINATORIA: rechazo directo.**
- **Veracidad** → los ingresos de su PDF están **38% por encima** de lo que él
  mismo le reportó a la central. → **0.0 + alerta roja de posible maquillaje.**
- **Riesgo de la central** → 470 puntos (banda de riesgo alto) + mora reciente.
  → **0.0**

**Puntaje: 0 → RECHAZADO**, con el motivo explícito: *"el servicio de deuda
supera el EBITDA ajustado"*.

**La moraleja:** aunque la regla eliminatoria no existiera, este cliente habría
sido rechazado por puntaje. Y aunque el puntaje hubiera dado bien, el tope por
riesgo alto de la central le habría cerrado la puerta a una aprobación
automática. **Tres cierres independientes.**

**Cómo se lo cuentas al cliente:** no, y no es una sola cosa — le infló los
ingresos un 38% frente a lo que él mismo le reportó a la central, tiene $8.2
millones vencidos **hoy** en el sistema financiero, viene con moras en los
últimos cuatro meses y su operación ya no da ni para la deuda que tiene. Este es
exactamente el despacho que usted no quiere hacer, y es el caso que justifica la
herramienta: sin estudio, esa venta se hacía.

### Caso D — "María Gómez", persona natural ⚠️ APROBADO CON CONDICIONES

**Pide:** $4 millones a 60 días.

| Su situación | |
|---|---:|
| Utilidad de su actividad comercial (según su PDF) | 36 |
| Lo que ya paga en deudas al año | 8 |
| Puntaje en la central | 690 |
| **Ingreso reportado en la central** | **$2 millones/mes** |
| **Porcentaje ya comprometido en cuotas** | **40%** |

**El análisis:**

- **Salud financiera** → su negocio luce sano en el papel. → **1.0**
- **Capacidad de pago** → sus estados financieros implican $2.33 millones al mes.
  **Pero la central certifica que gana $2 millones y ya tiene comprometido el
  40%**: su ingreso disponible real es **$1.2 millones al mes**. Manda el menor.
  En 60 días acumula $2.4 millones para pagar $4 millones: **no alcanza**. → **0.0**
  - *Alerta roja adicional:* el PDF implica una capacidad ($2.33M) **mayor a lo
    que ella gana** ($2M). Nadie paga con más de lo que ingresa → revisar el PDF.
- **Coherencia de plazos** → cobra a 30 días y paga a 60. → **1.0**
- **Exposición del capital** → pide más del doble de lo que su operación absorbe.
  → **0.0**
- **Riesgo de la central** → 690 puntos, banda "Aceptable", sin mora. → **0.6**

**Puntaje: 42 → APROBADO CON CONDICIONES (apenas). Monto avalado: $2.4
millones**, no los $4 que pidió — es lo que su ingreso verificado acumula en 60
días.

**La moraleja:** antes de la regla del ingreso, este mismo caso puntuaba 70.8 y
se avalaban los $4 millones completos con una simple advertencia. Hoy el sueldo
real manda sobre el papel.

**Cómo se lo cuentas al cliente:** en el papel su negocio se ve sano y en la
central se porta bien; el problema es el **tamaño del pedido**. Con el ingreso
que la central le certifica, y descontando lo que ya tiene comprometido en
cuotas, en 60 días junta $2.4 millones. Hay dos salidas comerciales: despacharle
$2.4 millones ahora, o darle unos 100 días para los $4 millones. Ninguna de las
dos es "perder el cliente".

### Los cuatro, lado a lado

| | A — La Sabana ✅ | B — El Tornillo ⚠️ | C — El Atajo ⛔ | D — María ⚠️ |
|---|---:|---:|---:|---:|
| **Puntaje** | 97 | ≈60 | 0 | 42 |
| **Veredicto** | Aprobado | Con condiciones | Rechazado | Con condiciones |
| Cobertura del pago | 1.5 veces | 1.08 veces | negativa | 0.6 veces |
| Salud del negocio | Segura | Gris | Crítica | Segura |
| Diferencia PDF vs central | 3% | 14% | **38%** | no aplica |
| Puntaje en la central | 745 | 668 | 470 | 690 |
| **Monto avalado** | $30M | $4.5M | — | $2.4M *(pidió $4M)* |

**Las cuatro lecciones que conviene memorizar:**

1. **Ninguna cifra buena compensa una eliminatoria.** El Atajo habría sido
   rechazado solo por su capacidad de pago negativa, sin mirar nada más.
2. **Se evalúa la solicitud, no solo al cliente.** Si La Sabana hubiera pedido
   $100 millones a 30 días, su cobertura se rompe y el veredicto cambia.
3. **La central manda sobre el riesgo, no sobre el monto.** Pone un tope al
   veredicto y —en persona natural— acota la capacidad de pago; pero el monto lo
   deciden los estados financieros.
4. **La mora vieja no persigue al cliente.** La de El Tornillo, de hace 8 meses y
   ya normalizada, le costó centésimas. La de El Atajo, reciente, pesó fuerte.

---

## 10. Preguntas que te van a hacer

**"Mi cliente tiene 750 en DataCrédito, ¿por qué salió rechazado?"**
Porque el puntaje de la central mide **cómo ha pagado en el pasado**, no si
**esta operación en particular** le cabe en la caja. Un cliente impecable puede
estar pidiendo un cupo que su flujo no soporta en ese plazo. Son dos preguntas
distintas y Creditia responde las dos.

**"¿Por qué avalan menos de lo que pidió?"**
Porque el monto se acota a lo que su capacidad de pago **acumula durante los días
del plazo**. Si pide $10 millones a 30 días pero su caja libre es de $4 millones
al mes, el sistema avala $4 millones. Ampliar el plazo, no reducir el cupo, suele
ser la salida — y es una excelente conversación comercial.

**"La central le sugiere $10 millones y ustedes avalan $45. ¿No es riesgoso?"**
El monto sugerido de la central es notoriamente conservador y no conoce el
detalle de los estados financieros del cliente. Creditia avala con base en la
caja real y **alerta explícitamente** cuando la brecha es grande (más de 1.5
veces, y en rojo si supera 3 veces). La decisión final la toma el analista con
las dos cifras a la vista.

**"El cliente no ocultó nada, ¿por qué la Veracidad quedó en cero?"**
Porque no hubo **con qué** verificar: la central no tiene sus estados
financieros. Tratándose de una persona jurídica —que está obligada a
reportarlos—, la ausencia de respaldo no es neutral. No estamos diciendo que
mintió; estamos diciendo que nadie lo puede confirmar.

**"El cliente cargó los estados financieros de 2025 en febrero de 2026 y salió
una advertencia."**
Es normal y esperado: el plazo para reportar a las entidades todavía no ha
vencido, así que la central sigue mostrando 2024. Creditia calcula con las cifras
más frescas (las del PDF) y avisa que no se pudieron verificar. Cuando la central
publique ese año, basta con volver a analizar el estudio.

**"La central trae las cifras del cliente incompletas y sale no viable."**
El usuario puede **elegir manualmente** calcular sobre el PDF. El resultado deja
constancia de que la fuente la eligió una persona, y el contraste de veracidad se
mantiene.

**"¿Puedo cambiar el peso de las dimensiones?"**
Sí, cada empresa configura los suyos, y por separado para personas y empresas.
Reglas: los pesos suman 100, ninguna dimensión activa puede tener menos de 5
puntos (si no la quieres, se apaga, no se le baja el peso), y *Capacidad de pago*
y *Riesgo de la central* no se pueden apagar.

**"Si cambio la configuración, ¿se recalculan los estudios anteriores?"**
No. Cada estudio queda **congelado** con la configuración vigente al momento del
análisis, junto con las cifras que usó. Un estudio de hace seis meses se puede
auditar y se sabe exactamente con qué reglas se decidió.

**"¿Cuántas consultas gasta un estudio?"**
Una: la de la central, al crear el estudio. Cargar el PDF, analizar, volver a
analizar o pedir el informe con IA **no consumen bolsa**.

**"El PDF venía escaneado, ¿funciona igual?"**
Sí, la IA lee documentos escaneados o fotografiados. Pero lo **advierte**: los
dígitos leídos de una foto son menos confiables que los de un PDF digital, así
que se emite una alerta de legibilidad. Lo que sí se rechaza de entrada es un
archivo que no sea realmente un PDF.

---

## 11. Glosario

| Término | En palabras simples |
|---------|---------------------|
| **Cupo** | El monto que la empresa le quiere prestar al cliente. |
| **Plazo** | Los días que le da para pagar. |
| **EBITDA** | La utilidad que deja la operación del negocio: ingresos menos costos y gastos operativos. La "caja gruesa" antes de deudas e impuestos. |
| **Servicio de deuda** | Lo que el cliente ya paga cada año por las deudas que tiene hoy. |
| **Capacidad de pago mensual** | Lo que le queda libre al mes para deuda **nueva**, después de atender lo que ya debe. |
| **Pago único al vencimiento** | El cupo completo, que se paga una sola vez al final del plazo (el crédito comercial no tiene cuotas). |
| **Rotación de cartera** | Los días que el cliente tarda, en promedio, en cobrarle a sus propios clientes. |
| **Ciclo de caja** | Los días que su plata está "atrapada" en la operación: lo que tarda en cobrar + lo que la mercancía pasa en bodega − lo que le fían sus proveedores. |
| **Z-Score de Altman** | Fórmula clásica de la banca que combina cinco señales del negocio en un número y lo ubica en zona segura, gris o crítica. |
| **Puntaje de la central** | Calificación de DataCrédito Experian, de 150 a 950. Más alto = mejor historial. |
| **Monto sugerido** | El monto que la central avalaría. Para Creditia es **referencia**, no techo. |
| **Persona natural / jurídica** | Un individuo con cédula / una empresa con NIT. Se analizan con las mismas fórmulas, pero con fuentes de información distintas. |

---

> **En resumen, lo que vendes:** Creditia hace en minutos lo que un analista
> financiero experimentado hace en horas — con la misma vara para todos los
> clientes, cruzando dos fuentes de información, declarando siempre qué tan
> confiable es cada cifra y dejando todo congelado y auditable. No reemplaza el
> criterio del analista: le pone al frente, ordenados y explicados, todos los
> datos que necesita para decidir en un minuto.
