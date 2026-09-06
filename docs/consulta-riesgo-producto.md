# Consulta de Riesgo Crediticio — Ficha de producto (comercial + técnica)

> Documento interno. La cara comercial define QUÉ se vende y CÓMO hablar del
> producto sin riesgo legal; la técnica resume cómo funciona y cómo se opera.
> Referencia técnica completa: `docs/consulta-riesgo-crediticio.md`.

---

## PARTE 1 — FICHA COMERCIAL

### Elevator pitch

**Sepa con quién está negociando antes de fiar, prestar o financiar.** En
minutos y sin pedirle un solo documento a su cliente, Creditia consulta a la
persona en las centrales de riesgo (con su autorización firmada digitalmente),
analiza el resultado con IA y le entrega un informe claro: nivel de riesgo,
señales de alerta, señales a favor, cifras clave y los próximos pasos que un
analista de crédito senior le recomendaría. Todo en un PDF con su marca de
respaldo, listo para archivar en el expediente del cliente.

### El problema que resuelve

Comercios, distribuidores y prestamistas pequeños fían y financian a personas
naturales **a ciegas** o con procesos lentos: pedir papeles espanta al cliente,
y un reporte de central "en bruto" es ilegible para quien no es analista. El
resultado: cartera mala que se pudo evitar, o ventas perdidas por miedo.

### Qué recibe el cliente (entregable)

Un **informe digital y PDF con marca Creditia** que incluye:

- **Nivel de riesgo** (bajo / medio / alto) con un **concepto de analista**
  redactado por IA: qué caracteriza el perfil, cómo se dimensiona el monto
  solicitado frente a la capacidad observada y qué cambiaría la lectura.
- **Señales de alerta (red flags)** y **señales a favor**, cada una explicada.
- **Cifras clave**: saldos, mora, % de endeudamiento, cuota mensual ya
  comprometida, deudas como codeudor, ingreso mensual reportado, créditos
  vigentes/cerrados.
- **Actividad por sector** (bancos, comercio, cooperativas, telcos) y
  **hábito de pago mes a mes** en un semáforo visual propio.
- **Contraste del monto**: lo que el cliente pide vs la referencia de la
  central (calculado por Creditia, no una aprobación).
- **Verificación de identidad**: el nombre digitado vs el registrado en la
  central, y validación en listas restrictivas (SARLAFT).
- **Próximos pasos recomendados**: qué documentos pedir, qué verificar y qué
  condiciones prudentes estructurar (codeudor, monto escalonado, plazo).

### A quién se le vende

- Comercios que venden a crédito o a cuotas (electrodomésticos, motos, muebles).
- Prestamistas y fintechs pequeñas de libranza/consumo.
- Inmobiliarias y arrendadores (perfil del arrendatario).
- Empresas de servicios que facturan pospago.
- Cualquier pyme que hoy "fía de palabra".

### Cómo se posiciona frente a los otros productos Creditia

| | **Consulta de riesgo** | Estudio de capacidad de pago | Estudio empresarial |
|---|---|---|---|
| Para quién | Persona natural | Persona natural | PN o PJ con EEFF |
| Documentos del cliente | **Ninguno** | Extractos + soportes de ingreso | Estados financieros |
| Tiempo | **Minutos** | Horas (carga y extracción) | Horas |
| Entrega | Informe IA del perfil en centrales | Cuota máxima y endeudamiento sobre flujo real | Score, indicadores y cupo sugerido |
| Pagaré digital | No | Sí | Sí |
| Precio | **El más bajo** (bolsa propia) | Bolsa de estudios | Bolsa de estudios |

**Guion corto**: "Si necesita decidir YA y sin papeles → Consulta de riesgo.
Si va a prestar un monto importante y quiere ver el flujo de caja real →
Estudio de capacidad. Si evalúa una empresa → Estudio empresarial."

### Modelo de precios

- Se vende por **paquetes prepago de consultas** (bolsa propia, separada de la
  bolsa de estudios: precios distintos, saldos distintos, sin mensualidades).
- Cada consulta descuenta 1 unidad de la bolsa. **El análisis IA y el reintento
  si algo falla no tienen costo adicional.**
- La consulta a la central tiene vigencia: repetir la consulta del mismo
  titular dentro de la ventana de vigencia reutiliza el resultado (no se paga
  doble a la central).

### Lo que SÍ se puede decir (claims aprobados)

- "Consultamos a su cliente en las centrales de riesgo, con su autorización."
- "Informe claro con análisis de IA: red flags, señales a favor y cifras clave."
- "Sin pedirle documentos al titular. Resultados en minutos."
- "Servicio de consulta, verificación y análisis del perfil de riesgo crediticio."
- "Autorización del titular con firma electrónica (Ley 1266 de 2008 — habeas data)."
- Citar cifras del informe (score, saldos, moras) — son dato transformado.

### Lo que NUNCA se puede decir ni hacer (marco legal)

- ❌ Vender, mostrar o entregar **"el reporte de DataCrédito"**: la reventa del
  reporte está prohibida por el contrato con la central. Se vende el
  **SERVICIO de análisis e interpretación**; el reporte es insumo interno.
- ❌ Nombrar la marca de la central en el informe o en la factura. La
  atribución en informes es genérica: **"Fuente: centrales de riesgo"**
  (decisión 2026-09-05). El ítem DIAN se factura como **"Servicio de consulta,
  verificación y análisis de perfil de riesgo crediticio"** — jamás "venta de
  reporte".
- ❌ Prometer aprobaciones o decisiones: el informe es interpretación de
  referencia; **la decisión de crédito es de quien otorga**.
- ❌ Consultar sin autorización firmada del titular (el sistema lo bloquea).
- ❌ Replicar el layout/tablas del reporte de la central en cualquier material.

### Objeciones frecuentes

- *"¿Esto es legal?"* — Sí: consulta con autorización previa y expresa del
  titular (firma electrónica, Ley 1266), y lo que se entrega es un análisis
  propio, no el reporte de la central.
- *"¿Y si mi cliente no tiene historial?"* — El informe lo dice con claridad y
  lo diferencia de un mal pagador: explica que es incertidumbre, no
  incumplimiento, y recomienda cómo cubrirse (soportes de ingreso, codeudor,
  monto inicial menor).
- *"¿Reemplaza al estudio de crédito?"* — No: es el filtro rápido y económico.
  Para montos grandes, el estudio completo sigue siendo el camino.

---

## PARTE 2 — FICHA TÉCNICA

### Resumen

Tercer tipo de estudio (`study_type = bureauCheck`) con **flujo backend
propio** (`src/bureau-check/`), fila en `credit_studies` (cobro 1:1, listados y
dashboards compartidos) y **bolsa/precio por producto** (`pack_product_type`:
`creditStudy` | `bureauCheck`). Solo persona natural (cc/ce/pas — sin NIT).
Dark launch tras el feature flag `bureauCheck` (bloquea solo la creación y la
visibilidad comercial; ver/analizar/PDF de consultas existentes nunca se
bloquea).

### Flujo end-to-end

```
Usuario (webApp /app/estudio-credito/consulta-riesgo)
  └─ POST companies/:companyId/bureau-checks
       1. Flag bureauCheck encendido (400 si no)
       2. Solo PN (cinturón pre y post consulta)
       3. Gate de autorización (Zapsign, Ley 1266) → 'authorization_pending' si falta firma
       4. Consulta a la central (con caché de vigencia compartida entre productos)
       5. Consumo FIFO de la bolsa bureauCheck (409 sin saldo) + fila credit_studies
          → estado pendingStudyAnalysis
  └─ POST :id/perform   (el front lo llama solo; reintento GRATIS si falla)
       - Código: keyFigures + amountComparison + timeline/stats/tendencia/identidad
       - IA: concepto, riskLevel, redFlags, señales, secciones, recomendaciones
       - Persistencia: bureau_check_analyses (upsert) → estado studyCompleted
  └─ GET :id            (detalle: identidad + análisis; el snapshot crudo NUNCA viaja)
  └─ GET :id/pdf        (informe Handlebars propio vía Gotenberg)
```

### Arquitectura

- **Módulo separado**: `bureau-check.controller/service/repository` — cero
  branches nuevos en `credit-studies`; los endpoints viejos (steps, perform,
  pdf, analyze, pagaré, reset de soporte) **rechazan** estudios bureauCheck.
- **Reuso por inyección**: `CustomerAuthorizationsService.resolveForConsult`
  (gate de firma), `CreditBureauService.consult` (consulta + caché),
  `AnalysisPacksService.consumeCreditForStudy({productCode: 'bureauCheck'})`.
- **Derivados puros** en `bureau-check-analysis.utils.ts` (testeables sin
  Prisma): `buildAmountComparison`, `buildPaymentTimeline`, `buildPaymentStats`,
  `buildBalanceTrend`, `buildSectorTotals`, `namesMatch`, `normalizeAnalysis`.

### El análisis (código + IA)

- **Código (determinístico)**: cifras clave congeladas al perform
  (saldos, mora, % deuda, cuota mensual, codeudas, créditos vigentes/cerrados,
  `sectorActivity`, `paymentTimeline` + `paymentStats` del vector mensual,
  `balanceTrend` trimestral, `alertsDetail`, `txtProbabilidad` de la central)
  y `amountComparison` (within ≤1x / above ≤1.5x / far_above). La verificación
  de identidad compara el nombre digitado en la autorización vs el registrado
  en la central (`namesMatch`, tolerante a tildes/orden).
- **IA (interpretación)**: prompt en
  `src/ai/prompts/bureau-check-analysis.prompt.ts` → JSON estricto
  `{summary, riskLevel, redFlags[], positiveSignals[], sections{},
  recommendations[]}`. Reglas clave: criterio propio (no parafrasear a la
  central), distinguir "sin historial" de "mal comportamiento", estimaciones
  declaradas de carga de cuota, denso-no-extenso (límites de frases por
  bloque), sin marcas del proveedor, sin veredicto de aprobación.
- **Modelo**: `AI_BUREAU_CHECK_MODEL` (+`AI_MAX_TOKENS_BUREAU_CHECK`);
  en staging: `claude-opus-5` con 24k tokens (routing por prefijo de modelo;
  requiere `ANTHROPIC_API_KEY`). Sin configurar cae al provider global.
- **Resiliencia**: si la IA falla o responde mal formado, la consulta queda en
  `pendingStudyAnalysis` y el reintento es gratis (la consulta a la central ya
  quedó pagada y persistida). Re-perform permitido mientras el estudio no esté
  cerrado; reemplaza el análisis (upsert 1:1).

### Modelo de datos

- `credit_studies` — fila del estudio (studyType bureauCheck; requestedCreditLine
  solo para el contraste).
- `bureau_check_analyses` — 1:1: summary, riskLevel, redFlags, positiveSignals,
  sections, keyFigures, amountComparison, **recommendations**, aiAnalysisId.
- `customer_risk_snapshots` — insumo interno (JAMÁS viaja al front): incluye
  `txt_probabilidad`, `txt_recaudos`, `balance_evolution` y sectores con
  valorCuota/valorInicial/totalPrincipal/totalCodeudorOtros (miles→pesos).
  Solo consultas nuevas traen los campos enriquecidos; todo tolerante a null.
- Bolsas: `product_type_id` en `consultation_prices` (un ACTIVO por producto),
  `pack_offerings` (congelado al crear) y `analysis_packs` (congelado al
  comprar). El FIFO filtra por producto: las bolsas nunca se cruzan.
- Migraciones: `20260905153000_add_bureau_check` y
  `20260905220000_enrich_bureau_check_report` (staging ✅ · PROD ✅ 2026-09-06).

### Front (webApp)

- Ruta `consulta-riesgo` (creación, guard del flag) y `consulta-riesgo/:id`
  (detalle, sin guard). Un solo flujo visual: form → resumen → gate de firma →
  auto-perform con loader → informe.
- Informe en pantalla: banner de riesgo + concepto, cifras clave, contraste de
  monto, actividad por sector, semáforo mensual de hábito de pago, alertas,
  red flags/señales, análisis por área, próximos pasos, badge de identidad,
  PDF descargable. Atribución genérica "Fuente: consulta en centrales de riesgo".
- Comercial: 3ª tarjeta en el selector de tipo, tabs por producto en la compra
  (administración) y en `/precios`, indicador de saldo con dos píldoras.
  Tarjetas sin saldo salen bloqueadas con CTA "Comprar paquete" →
  `/app/administracion/analisis-credito?producto=bureauCheck`.

### Operación (encendido y día a día)

1. ✅ Migraciones aplicadas a staging y PROD (2026-09-06).
2. Portal admin: crear **precio** del producto "Consultas de riesgo" (menor al
   de estudios) y **ofertas** con su ítem DIAN nombrado como servicio.
3. Encender el flag `bureauCheck` (staging primero). Sin precio activo del
   producto, sus ofertas no salen del catálogo y la compra queda bloqueada.
4. Railway (PROD): agregar `AI_BUREAU_CHECK_MODEL` y
   `AI_MAX_TOKENS_BUREAU_CHECK` si se quiere el modelo dedicado.
5. Apagar el flag = kill switch de la creación; lo ya vendido sigue operando.

### Limitaciones conocidas

- Staging consulta el UAT de la central (perfiles mayormente sin historia).
- Snapshots consultados antes del enriquecimiento no traen cuota/codeudas/
  tendencia (pintan "—"); una consulta fresca del titular los trae.
- Sin pagaré digital en este producto (decisión de alcance).
- `nivelRiesgo`/`ratingSectorial` de la central son solo-PJ: no aplican aquí.
