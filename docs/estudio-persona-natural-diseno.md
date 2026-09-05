# Estudio de persona natural (sin EEFF) — diseño

> **Estado: EN DISEÑO (v0.3)**. Nada de este documento está implementado. Define
> el nuevo tipo de estudio para el segmento de prestamistas cuyos deudores son
> personas naturales sin estados financieros: asalariados e independientes con
> cuenta bancaria. Complementa (no reemplaza) al estudio de EEFF documentado en
> [`credit-study-scoring-v2.md`](./credit-study-scoring-v2.md).
>
> Las 10 decisiones abiertas de la v0.1 se resolvieron el **2026-08-28** (§9).
> El nombre de trabajo del producto es **"Estudio de capacidad de pago"**.
> La especificación de extracción por documento (validada contra documentos
> reales) vive en
> [`estudio-persona-natural-extraccion.md`](./estudio-persona-natural-extraccion.md);
> sus 3 hallazgos están incorporados aquí (§9, ajustes v0.3).

---

## 1. Objetivo — y qué NO es

**Objetivo:** responder al prestamista la pregunta *"¿esta persona me puede pagar
esta cuota?"* a partir de documentos que el deudor aporta voluntariamente, con un
score, una cuota máxima sugerida y una narrativa — el mismo playbook del estudio
de EEFF, aplicado a persona natural.

**Qué NO es (líneas rojas):**

| No es | Por qué |
|-------|---------|
| Un buró / central de riesgo | Administrar datos de comportamiento crediticio consultables por terceros es actividad regulada de "operador de información" (Ley 1266). Creditia opera bajo Ley 1581: tratamiento autorizado de datos que el titular aporta. |
| Una reventa de DataCrédito | Prohibido contractualmente. La central puede **complementar** el estudio (consulta PN ya integrada, con autorización), nunca ser el producto. |
| Un cruce entre empresas | La empresa A jamás ve datos, historial ni el hecho de que la empresa B consultó a la misma persona. Cruzar tenants nos convierte en operador de información. |

---

## 2. A quién sirve y a quién se analiza

**Cliente (quien paga):** prestamistas y originadores pequeños — personas
naturales que prestan formalmente, casas de crédito, fondos de empleados,
cooperativas pequeñas, financiadores de motos/electrodomésticos, libranzas.

**Sujeto de análisis (el deudor):** persona natural **con cuenta bancaria o
billetera** (Nequi/Daviplata cuentan). Los dos perfiles entran en v1; **no se
dividen en flujos distintos** — el mismo estudio, lo único que cambia son los
documentos que se piden:

| Perfil | Ingreso | Documentos que se piden |
|--------|---------|------------------------|
| **Asalariado** | Nómina formal | Extractos (3 meses) + desprendibles de nómina (2) |
| **Independiente** | Variable (ventas, honorarios) | Extractos (**3 meses**) + facturas o cuentas de cobro (opcionales) |

La ventana del independiente es el doble porque su señal de estabilidad vive
solo en el extracto: con 3 meses no se distingue un buen semestre de un ingreso
sostenido.

Dos exclusiones: el independiente 100% informal **sin ninguna cuenta ni
billetera** queda fuera (no hay documento que analizar), y el independiente
**con empresa formal y EEFF** no necesita este estudio — ese va por el flujo
actual de Creditia (estudio empresarial).

---

## 3. Los dos documentos

Criterios de selección: (a) que la fuente lo emita **sí o sí** y el deudor lo
obtenga solo, gratis y en PDF; (b) que aporte señal de capacidad de pago real;
(c) que entre sí permitan **verificación cruzada** (anti-fraude).

### Decisión propuesta

| # | Documento | Quién lo emite | Cuánto se pide |
|---|-----------|----------------|----------------|
| **1** | **Extracto bancario** | El banco — obligado a generarlo cada mes; descargable en PDF desde la app de todos los bancos y billeteras (**Nequi y Daviplata aceptadas en v1**) | **Últimos 3 meses** (ambos perfiles) — de la cuenta donde recibe su ingreso. Es un mínimo: quien aporte más meses se promedia sobre todos |
| **2** | **Desprendible de nómina** | El empleador — obligado por ley laboral a entregar comprobante de pago | **Últimos 2** desprendibles (solo asalariado) |

**El extracto es el documento universal** (el único que "sí o sí" emite un
banco) y el núcleo del análisis: sirve para ambos perfiles. **La nómina es el
segundo documento del perfil asalariado**: verifica el ingreso formal, muestra
las libranzas y embargos de nómina existentes (la respuesta útil a "¿está
embargada?") y habilita el cálculo del cupo de libranza (Ley 1527).

El independiente no tiene "segundo documento" obligatorio: su ingreso vive solo
en el extracto. Se le piden los mismos **3 meses** que al asalariado — 6 sonaba
más riguroso, pero la fricción de conseguirlos costaba más radicaciones de las
que salvaba, y el mínimo es un piso: quien aporte más meses se promedia sobre
todos ellos. Si mueve plata en más de una cuenta o billetera puede aportar los
extractos de todas (mejora la confianza); si solo aporta una cuenta con
movimientos pobres, el estudio corre igual pero lo declara en los flags de
confiabilidad.

Además, el independiente con clientes recurrentes puede aportar **facturas o
cuentas de cobro consecutivas (2)** como documento de ingreso opcional — caso
real: contratista remoto que factura vía Deel. Habilitan el índice de
verificación (factura × TRM ≈ abono del extracto, banda ±10%) igual que la
nómina lo hace para el asalariado. Ver la spec en
[`estudio-persona-natural-extraccion.md`](./estudio-persona-natural-extraccion.md) §4.

### Requisitos de forma

- PDF **original descargado del banco/empleador** (no foto, no escaneo): el
  extractor y las validaciones de metadatos lo necesitan.
- Extractos: **ventana de meses consecutivos** (3 asalariado, 6 independiente),
  **en uno o varios PDFs** — Bancolombia, por ejemplo, emite el de ahorros
  trimestral: un solo PDF puede cubrir toda la ventana. Corte más reciente
  ≤ 45 días.
- Nómina: el desprendible más reciente ≤ 45 días.
- Los extractos de una misma cuenta deben ser **consecutivos y de esa cuenta**
  (la continuidad de saldos — entre meses y fila a fila con el saldo corrido —
  es la validación anti-fraude central, ver §7); cuentas o billeteras
  adicionales se aportan como series completas aparte.

### Alternativas evaluadas y descartadas

| Documento | Por qué NO |
|-----------|-----------|
| Carta laboral | **Descartada también para v2.** No estandarizada, la emite el empleador "a demanda" y es el documento más fácil de fabricar. Su único aporte único (antigüedad laboral) se pide como **dato declarado** y se contrasta con la recurrencia del abono de nómina en los extractos. Si en v2 hiciera falta un tercer documento, la **planilla PILA** aporta más (IBC real, empleador, continuidad de aportes) y es estandarizada. |
| Certificación bancaria | Solo acredita titularidad de la cuenta; cero cifras. |
| RUT | No dice ingresos; solo actividad declarada. |
| Declaración de renta | Solo declarantes (excluye al segmento), anual y desactualizada. |
| Reporte de Midatacrédito aportado por el titular | Es dato del buró por otra vía: roza la prohibición contractual y la Ley 1266. La central entra solo como consulta directa autorizada (ya integrada). |
| Referencias comerciales / personales | No verificables, sin valor cuantitativo. |

---

## 4. Indicadores v1

Todos calculables a partir de los dos documentos. Agrupados por lo que miden.

### 4.1 Ingreso verificado

| Indicador | Cálculo | Lectura |
|-----------|---------|---------|
| Ingreso neto de nómina | Promedio del neto de los 2 desprendibles | Base del análisis del asalariado |
| Ingreso según extracto | Suma mensual de abonos recurrentes identificados como ingreso (excluyendo transferencias entre cuentas propias) | Base del independiente; contraste del asalariado |
| **Índice de verificación** | abono de nómina detectado en extracto ÷ neto del desprendible | ≈ 1.0 OK; < 0.9 **flag** (el ingreso que dice no es el que le llega) |
| Estabilidad del ingreso | Coeficiente de variación del ingreso mensual (sobre los meses realmente cubiertos por los extractos, mínimo 3); nº de meses con ingreso | CV alto o meses en cero = ingreso volátil |
| Antigüedad laboral | **Fecha de Ingreso del desprendible cuando aparece** (verificada — la muestra real la trae); dato declarado como fallback, contrastado con la recurrencia del abono en extractos | Inconsistencia = flag; sustituye a la carta laboral |
| Aportes a seguridad social (independiente) | Pagos `PSE Aportes en Línea`/SOI detectados en el extracto | El independiente que paga su propia PILA es formal y estable — señal positiva |

### 4.2 Capacidad de pago

| Indicador | Cálculo | Lectura |
|-----------|---------|---------|
| Compromisos fijos mensuales | Categorías `utilities`, `telecom`, `health`, `education`, `insurance`, `rent`, `subscription`, `bank_fee` ÷ meses de la ventana. Excluye impuestos (4x1000) | Gasto contractual que no se baja de un mes a otro |
| Costo de vida observado | Categorías `groceries`, `transport`, `purchase`, `atm_withdrawal` ÷ meses | **Se informa, NO se resta.** Es comprimible, y la subsistencia ya la protege el tope del 30% del ingreso en la cuota máxima: restarlo además cobraría dos veces la misma protección |
| Cuotas de crédito | `loan_payment` + cuotas probables por recurrencia (**deuda invisible al buró**) + libranzas y embargos del desprendible | Deuda comprometida: es el numerador del DTI |
| Pago de tarjetas | `cc_payment` ÷ meses | Resta del disponible (la plata sale) pero **NO cuenta como deuda**: el extracto no distingue el pago mínimo (deuda) del pago total (consumo del mes). Contarlo en el DTI declara sobreendeudado a quien usa la tarjeta como medio de pago. Si supera el 50% del ingreso se emite una alerta de revisión |
| **Ingreso disponible** | ingreso verificado − compromisos fijos − (cuotas de crédito + tarjetas) | Lo que de verdad queda **antes** del costo de vida |
| **Cuota máxima sugerida** | min( 30% del ingreso neto verificado, 70% del ingreso disponible ) | El número que el prestamista necesita. **Fijos en v1**; configurables por empresa en v2 (misma filosofía que los pesos del scoring) |
| Cuotas mínimas para el monto solicitado | ceil( monto solicitado ÷ cuota máxima ), **sin intereses** | Contraste informativo, no veredicto: plazo y tasa los pone quien otorga. El simulador del front traduce esto a un plan real con tasa (sistema francés) |
| **Cupo de libranza** (si aplica) | 50% × (devengos salariales − descuentos de ley) − (libranzas + embargos existentes) — Ley 1527: el asalariado debe recibir al menos el 50% del neto. Requiere clasificar los conceptos del desprendible (los beneficios flexibles "espejo" se netean; ver extracción §5) | Cupo legal restante para descuento directo |

### 4.3 Endeudamiento

| Indicador | Cálculo | Umbral propuesto |
|-----------|---------|------------------|
| DTI actual | **cuotas de crédito** (sin tarjetas) ÷ ingreso neto verificado | < 30% sano · 30–45% justo · > 45% crítico. Es el que manda en la dimensión |

**No hay DTI proyectado** (decisión 2026-08-29): se construía con una cuota
implícita derivada del plazo solicitado, y al no pedirse plazo esa proyección no
existe — era además arbitraria, medía la operación y no a la persona. El DTI
actual es un hecho verificado; la proyección, si el otorgante la quiere, sale
del simulador con SU tasa y SU plazo.

### 4.4 Comportamiento financiero (solo extracto)

| Señal | Lectura |
|-------|---------|
| Saldo promedio y saldo mínimo del período | Colchón real |
| Días con saldo en cero o sobregiro | Vive al límite |
| % del ingreso retirado en las 48h siguientes al abono | Retiro total inmediato = la cuenta es un peaje, no una cuenta |
| Rechazos de débitos / devoluciones | Incumplimientos en curso |
| Apuestas en línea como % del ingreso | Señal de riesgo (propuesta: > 5% warning, > 15% danger) |
| Pagos visibles a otros prestamistas | Endeudamiento paralelo activo |

### 4.5 Consistencia documental (anti-fraude — alimenta la dimensión Veracidad)

Ver §7.

---

## 5. Salida del estudio

La misma anatomía del estudio de EEFF:

1. **Score 0–100** sobre dimensiones del catálogo `scoring_dimensions`, con
   pesos configurables por empresa (motor v2 existente). Dimensiones de PN:

   | Dimensión | Insumo | Peso | Obligatoria |
   |-----------|--------|:----:|:-----------:|
   | Estabilidad del ingreso | §4.1 | 25 | ✅ |
   | Endeudamiento | §4.3 | 25 | ✅ |
   | Riesgo de la central | **Consulta MiDecisor PN incluida en el estudio** (con la autorización firmada, como hoy) | 20 | ✅ |

   **Thin file:** cuando la central responde sin puntaje (score 0 — la escala real
   arranca en ~150), con rating de recaudos `N` ("sin información suficiente para
   calificar") y sin mora ni comportamiento de pago, la dimensión se marca **no
   evaluable** y su peso se redistribuye, en vez de puntuarla como riesgo máximo.
   Castigar la AUSENCIA de información golpearía justo a la población que este
   estudio existe para atender. Solo aplica al estudio de capacidad; el motor
   EEFF conserva su comportamiento.
   | Comportamiento financiero | §4.4 | 15 | — |
   | Veracidad documental | §7 | 15 | — |

   **NO hay dimensión "capacidad de pago"** (decisión 2026-08-29). La capacidad
   ES el resultado del estudio — la cuota máxima sostenible de §4.2 —, no un
   factor de su puntaje. Puntuarla además la contaría dos veces: la holgura que
   mediría (disponible ÷ ingreso) es casi la misma cuenta que el endeudamiento
   (cuotas ÷ ingreso). Con esto el score mide **qué tan confiable es el perfil**
   y la magnitud viaja aparte, de modo que dos personas iguales sacan el mismo
   puntaje sin importar cuánto pidieron.

2. **Veredicto** (aprobado / condicionado / negado) con los mismos umbrales del
   motor actual (≥75 / ≥40): aplican igual — lo que cambia es **cómo se calcula
   cada dimensión** (indicadores PN de §4, no ratios de EEFF). Las eliminatorias
   propias siguen vivas: sin ingreso verificable, o disponible ≤ 0.
3. **Cuota máxima sostenible** (§4.2). El estudio **no pide plazo** ni avala un
   cupo: el monto solicitado es contexto y solo se contrasta ("cabría en mínimo
   N cuotas, sin intereses"). Plazo, tasa y monto los decide quien otorga el
   crédito; el front ofrece un simulador de amortización como guía, que no forma
   parte del estudio ni se persiste.
4. **Narrativa IA** (mismo motor, prompt propio para PN).
5. **Flags de confiabilidad** de la extracción (mismo mecanismo del extractor de
   EEFF) + flags de consistencia (§7).

---

## 6. Flujo del estudio (conceptual)

Cada paso mapea a una pieza que ya existe; no hay infraestructura nueva:

| Paso | Pieza existente |
|------|-----------------|
| 1. Alta del cliente PN | `Customer` con `personType` natural |
| 2. Autorización de tratamiento firmada | Gate Zapsign por identidad (habeas data) |
| 3. Carga de los 2 documentos (PDF) | Mismo mecanismo de upload del estudio |
| 4. Extracción IA por tipo de documento | Extractor PDF con flags de confiabilidad (nuevos prompts: extracto, nómina) |
| 5. Cálculo de indicadores (§4) | Nuevo módulo de indicadores PN (análogo a `financial-indicators`) |
| 6. Score + veredicto | Motor de scoring v2 con dimensiones PN |
| 7. Narrativa | Motor IA actual |
| 8. Consulta PN DataCrédito (parte del estudio) | Integración MiDecisor existente |
| 9. (Cierre) pagaré firmado | Pagaré Zapsign |
| Cobro | **1 consulta del pack, mismo precio** que el estudio empresarial |

---

## 7. Anti-fraude: validaciones de consistencia

El riesgo técnico nº 1 del segmento son los PDFs adulterados. Defensa por capas,
cada hallazgo baja la dimensión Veracidad y queda en la narrativa:

| Validación | Qué detecta |
|------------|-------------|
| Abono de nómina en el extracto ≈ neto del desprendible | Nómina inflada o extracto ajeno |
| Saldo final del mes N = saldo inicial del mes N+1 | Extracto editado o meses de cuentas distintas |
| Suma de movimientos = variación del saldo (por mes) | Movimientos borrados/insertados |
| Titular del extracto y de la nómina = identidad del Customer autorizado | Documentos de un tercero |
| Metadatos del PDF (productor, fecha de creación vs período, editor) | PDF regenerado con herramientas de edición |
| Ingresos siempre en cifras redondas / sin ruido transaccional | Extracto fabricado |

**A mediano plazo**, la mitigación estructural es open finance: el Decreto 0368
de 2026 lo hace obligatorio en Colombia — el extracto llegará directo del banco
con autorización del titular, sin PDF de por medio. Este diseño deja el PDF como
**formato de entrada v1**, reemplazable por API sin tocar los indicadores.

---

## 8. Marco legal (resumen operativo)

- **Ley 1581 (protección de datos):** base de la operación — el titular autoriza
  (firma Zapsign ya implementada) y aporta sus propios documentos.
- **Ley 1266 (habeas data financiero):** NO aplicar — no somos operador mientras
  no exista consulta cruzada entre empresas ni base de comportamiento propia.
- **Ley 1527 (libranza):** fuente del indicador de cupo (§4.2).
- **Contrato DataCrédito:** revisar por escrito la frontera de "competir" antes
  de lanzar. La central es complemento opcional, jamás el producto.
- **Reputacional:** sin KYC adicional en v1 — el onboarding y la facturación ya
  dejan trazada la identidad de quien paga. La defensa son los **términos de
  uso**: usos prohibidos explícitos (perfilamiento para cobro extorsivo, gota a
  gota) y derecho de suspensión. El pitch es formalización del crédito popular.

---

## 9. Decisiones tomadas (2026-08-28)

| # | Tema | Decisión |
|---|------|----------|
| 1 | Perfiles en v1 | **Ambos**, sin dividir el flujo: cambia solo qué documentos se piden. El independiente con empresa formal y EEFF va por el estudio empresarial actual. |
| 2 | Ventana de extractos | **Mínimo 3 meses en ambos perfiles.** El independiente arrancó en 6 —su estabilidad vive solo en el extracto— pero la fricción no lo justificó; es un piso, no un tope. |
| 3 | Billeteras (Nequi/Daviplata) | **Aceptadas en v1** como extracto válido. |
| 4 | Cuota máxima (30% neto / 70% disponible) | **Fijos en v1**; configurables por empresa en v2. |
| 5 | DataCrédito | **MiDecisor PN 100% incluido en el estudio** — dimensión "Riesgo de la central" obligatoria, con la autorización firmada. |
| 6 | Carta laboral | **Descartada definitivamente** (también v2): la antigüedad se pide como dato declarado y se contrasta con los abonos del extracto. Si algún día se necesita un tercer documento, la candidata es la planilla PILA. |
| 7 | Umbrales de veredicto | **Los mismos** (≥75 / ≥40); lo que cambia es el cálculo de cada dimensión (indicadores PN, no ratios de EEFF). |
| 8 | Precio | **Misma consulta del pack**, sin tarifa diferenciada. |
| 9 | Nombre | **"Estudio de capacidad de pago"** (persona natural); el actual pasa a comunicarse como estudio **empresarial**. Naming comercial final pendiente de marketing. |
| 10 | KYC del prestamista | **Sin verificación adicional en v1**: la identidad ya queda trazada en onboarding/facturación; la defensa son los términos de uso (usos prohibidos + suspensión). |

### Ajustes v0.3 — tras analizar documentos reales (2026-08-28)

Muestra: extracto Bancolombia trimestral + 2 facturas Deel de contratista. Ver
el detalle en [`estudio-persona-natural-extraccion.md`](./estudio-persona-natural-extraccion.md).

| # | Ajuste | Detalle |
|---|--------|---------|
| 11 | Ventana en 1..N PDFs | Un PDF puede cubrir varios meses (Bancolombia ahorros = trimestral); el requisito es la **ventana**, no el número de archivos. |
| 12 | Factura recurrente como documento de ingreso del independiente | 2 facturas/cuentas de cobro consecutivas (Deel, plataformas, clientes fijos), opcional; cruce contra el abono del extracto con TRM ± 10%. |
| 13 | Señal de aportes PILA | Pagos propios a seguridad social visibles en el extracto = formalidad del independiente (indicador nuevo en §4.1). |

---

## 10. Fuera de alcance v1

- Open finance / conexión directa a bancos (v2+, cuando madure el Decreto 0368).
- Deudores sin ninguna cuenta ni billetera.
- Scoring de cosechas / comportamiento del portafolio del prestamista.
- Carta laboral (descartada definitivamente, §9.6), referencias, garantías y
  codeudores. Planilla PILA reservada como candidata si v2 necesita un tercer
  documento.
- Porcentajes de cuota máxima configurables por empresa (v2, §9.4).
- Cualquier funcionalidad que muestre datos de una persona a más de una empresa.
