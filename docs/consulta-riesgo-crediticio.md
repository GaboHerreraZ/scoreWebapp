# Consulta de riesgo crediticio (`bureauCheck`)

> Tercer tipo de estudio: servicio de consulta, verificación y **análisis IA** del
> perfil crediticio de una persona natural en las centrales de riesgo. Sin
> documentos, más barato que un estudio completo, con **bolsas y precio propios**.

## 1. Qué es (y qué NO es)

- **Es**: un servicio de análisis e interpretación. La IA lee el snapshot de la
  central y entrega un informe con marca Creditia: resumen, nivel de riesgo
  (low/medium/high), red flags con severidad, señales a favor, análisis por
  áreas, cifras clave y el contraste del monto solicitado vs el sugerido.
- **NO es**: reventa del reporte de la central. **Por políticas de uso el
  reporte crudo nunca se muestra**: ni tablas, ni el layout de MiDecisor, ni el
  snapshot completo viajando al front. El entregable es siempre *dato
  transformado* con atribución genérica "Fuente: centrales de riesgo" (decisión
  2026-09-05: sin nombrar la marca del proveedor en los informes).

### Marco legal (resumen)

- Lo que se factura es el **servicio** ("Servicio de consulta, verificación y
  análisis de perfil de riesgo crediticio"), nunca "venta de reporte". Los ítems
  DIAN de sus ofertas se nombran así.
- Ley 1266 (habeas data): cubierta por el gate Zapsign existente — la firma del
  titular es prerequisito de cualquier consulta, sin cambios.
- El informe (pantalla y PDF) lleva atribución de fuente y disclaimer: es una
  interpretación de referencia, la decisión es de quien otorga.

## 2. Arquitectura: flujo backend propio

Decisión clave: **cero branches nuevos en credit-studies**. El módulo
`src/bureau-check/` tiene sus propios endpoints y reusa por inyección los
services existentes (gate de autorización, consulta con caché, consumo FIFO).
La fila sigue siendo un `CreditStudy` (`study_type = bureauCheck`): conserva el
cobro 1:1 (`AnalysisConsumption.creditStudyId @unique`), el listado y dashboards.

| Endpoint | Hace |
|---|---|
| `POST companies/:companyId/bureau-checks` | flag + PN-only → gate firma → consulta MiDecisor (caché) → consume bolsa `bureauCheck` → crea en `pendingStudyAnalysis` |
| `POST .../:id/perform` | cifras clave + contraste de monto (código) → prompt IA (JSON estricto) → upsert `BureauCheckAnalysis` → `studyCompleted` |
| `GET .../:id` | identidad + análisis (el snapshot crudo NO viaja) |
| `GET .../:id/pdf` | informe con plantilla propia (`pdf/templates/bureau-check-report.template.html`) |

- Estados: `pendingStudyAnalysis` → `studyCompleted`. El front auto-llama
  perform tras crear (un solo flujo visual); si la IA falla, la consulta queda
  pendiente y el **reintento es gratis** (la bolsa ya se descontó).
- Los flujos existentes RECHAZAN bureauCheck con mensaje claro: `createFromBureau`
  (validación del DTO), `performStudy`, `getSteps` (→ también su PDF), `analyze()`,
  reset de soporte. El pagaré se auto-protege (exige viabilityStatus, que aquí no existe).
- La caché de consulta fresca se comparte entre tipos: una consulta reciente le
  sirve a un estudio completo posterior (feature, no bug).

### El análisis (perform)

- **Código (determinístico)**: `keyFigures` (subset curado del snapshot:
  score, saldos, mora, % deuda, ingreso reportado, cuota/ingreso, sectores,
  y desde el enriquecimiento 2026-09: cuota mensual total, obligaciones como
  codeudor, créditos vigentes/cerrados, `sectorActivity[]` por sector con
  actividad, `paymentTimeline[]`/`paymentStats` del vector mensual Tabla 9,
  `balanceTrend` de la evolución trimestral, `alertsDetail[]` con fecha y
  `txtProbabilidad` de la central) y `amountComparison` (solicitado vs
  `montoSugerido`: within ≤1x, above ≤1.5x, far_above; nunca IA). Derivados
  puros en `bureau-check-analysis.utils.ts` (`buildPaymentTimeline`,
  `buildPaymentStats`, `buildBalanceTrend`, `buildSectorTotals`, `namesMatch`).
- **Identidad**: `getDetail` contrasta el nombre digitado en la autorización
  (`CustomerAuthorizationsService.getTypedTitularName`) contra el registrado en
  la central (`namesMatch`, tolerante a tildes/orden) → badge en front y PDF.
- **IA (interpretación)**: prompt `src/ai/prompts/bureau-check-analysis.prompt.ts`
  → JSON `{summary, riskLevel, redFlags[], positiveSignals[], sections{},
  recommendations[]}` (recommendations = 3-5 próximos pasos accionables, basados
  en el checklist de la central sin copiarlo literal). Reglas: citar cifras
  dentro de los textos, no reproducir tablas ni marcas del proveedor, no
  inventar score/veredicto, no avalar montos. Validación en
  `bureau-check-analysis.utils.ts` (`normalizeAnalysis`: estricta en
  summary/riskLevel, tolerante en listas). Modelo/presupuesto:
  `AI_BUREAU_CHECK_MODEL` / `AI_MAX_TOKENS_BUREAU_CHECK` (opcionales; caen al
  provider y `AI_MAX_TOKENS`). Corrida registrada en `AiAnalysis`
  (type `bureauCheckReview`).
- Persistencia: `bureau_check_analyses` (1:1 con el estudio, upsert por perform;
  patrón de `payment_capacity_analyses`; columna `recommendations` JSONB).
- **Insumos del mapper (migración `20260905220000`)**: el snapshot guarda
  `txt_probabilidad`, `txt_recaudos` y `balance_evolution` (PN); los sectores
  del JSONB `credit_sectors` traen además `valorCuota`, `valorInicial`,
  `totalPrincipal` y `totalCodeudorOtros` (miles→pesos); las alertas PN traen
  `date` (colocación); `customers.nationality`. Solo las consultas NUEVAS traen
  estos campos — snapshots viejos pintan `—` y el análisis los omite.

## 3. Bolsas y precio por producto (`pack_product_type`)

Parameter nuevo con codes `creditStudy` (estudios: EEFF + capacidad comparten
bolsa como siempre) y `bureauCheck`. `product_type_id` vive en:

- **`consultation_prices`** — un precio ACTIVO por producto
  (`getActivePrice(productCode)`); la regla "no desactivar el último activo"
  aplica solo a creditStudy (bureauCheck puede quedarse sin precio: sus ofertas
  salen del catálogo y su compra se bloquea — retiro deliberado).
- **`pack_offerings`** — el producto es create-only (congelado como quantity).
  `getCatalog()` cotiza cada oferta contra el precio de SU producto, agrega
  `product {code,label}` y omite ofertas sin precio activo.
- **`analysis_packs`** — congelado desde la oferta al comprar. El FIFO de
  consumo (`consumeCreditForStudy({productCode})`) filtra por él: **una bolsa
  jamás paga consumos del otro producto**. Mensaje de 409 por producto.

Saldos: `getBalance()` y el perfil (`permissions`) exponen `availableCredits`
(estudios, compat) + `availableBureauChecks`/`hasBureauCredits`. Sin cambios:
promo codes (% genérico), comisiones de vendedor, facturación por oferta,
`markOnboardingReady`. El techo de descuento del vendedor (DiscountCeiling)
usa SIEMPRE una oferta creditStudy como referencia.

## 4. Front

- **webApp**: ruta `consulta-riesgo(/:id)` (crear con `featureFlagGuard('bureauCheck')`),
  componente `features/credit-study/bureau-check/bureau-check-detail/` (form →
  gate de firma → auto-perform con loader → informe digerido; sin stepper).
  Selector de tipo con 3ª tarjeta; ruteo por mapa en listados y consumos;
  indicador de saldo con dos píldoras; **tabs por producto** en la compra
  (administración) y en `/precios` (visibles solo con flag + ofertas cotizables);
  onboarding ofrece solo packs de estudios (la preselección desde /precios se
  respeta para cualquier producto); `study-types-widget` con la 3ª tarjeta.
- **Portal admin**: producto en ofertas y precios (create-only) + columna;
  panel de precios vigentes por producto; sin pantallas nuevas.

## 5. Dark launch y encendido

Flag `bureauCheck` (nace apagado en staging y PROD). Corta SOLO la creación de
consultas y la visibilidad comercial (tarjeta del selector, tabs de packs);
ver/perform/PDF de consultas existentes nunca se bloquean.

Checklist para encender:
1. Crear `ConsultationPrice` de producto bureauCheck (precio menor).
2. Crear ofertas bureauCheck + asociar su ítem DIAN (nombrado como servicio).
3. Encender el flag desde el portal admin (staging primero).

## 6. Dónde tocar qué

| Quiero cambiar… | Toco… |
|---|---|
| Qué interpreta/dice la IA | `src/ai/prompts/bureau-check-analysis.prompt.ts` |
| Validación del JSON del modelo / contraste de monto | `src/bureau-check/bureau-check-analysis.utils.ts` |
| Qué cifras viajan al front | `buildKeyFigures` en `bureau-check.service.ts` |
| El informe PDF | `src/bureau-check/pdf/` (mapper + template propio) |
| El flujo create/perform | `src/bureau-check/bureau-check.service.ts` |
| FIFO / saldos por producto | `analysis-packs.repository.ts` (SQL) + `analysis-packs.service.ts` |
| Precio por producto | `consultation-prices.service.ts` / `.repository.ts` |
| La pantalla del front | `webApp: features/credit-study/bureau-check/` |
