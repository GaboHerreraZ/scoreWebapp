# Estudio de capacidad de pago — extracción de documentos

> **Estado: EN DISEÑO (v0.2)**. Especificación de QUÉ se extrae de cada documento
> y cómo se valida, construida sobre **documentos reales** (muestra interna del
> 2026-08-28: extracto Bancolombia + 2 facturas Deel de contratista + desprendible
> de nómina Globant DIC-2024). Complementa a
> [`estudio-persona-natural-diseno.md`](./estudio-persona-natural-diseno.md).
> Nada implementado; los prompts del extractor se afinarán contra estas muestras.
>
> ⚠️ El ejemplo trabajado de §6 usa datos personales reales (muestra interna).
> Este documento no se comparte fuera del equipo.

---

## 1. La muestra analizada

| Documento | Qué resultó ser | Observación clave |
|-----------|-----------------|-------------------|
| "Extractos de los últimos 3 meses" | **UN solo PDF** de Bancolombia (ahorros ****0937) que cubre **2026/03/31 → 2026/06/30** | Bancolombia emite el extracto de ahorros **trimestral**: un PDF ≠ un mes |
| "2 desprendibles de nómina" | **Facturas de contratista vía Deel** (jul y ago 2026, en USD, contra Lean Staffing Solutions) | No son nómina: son el documento de ingreso del **independiente** — contratista remoto, el perfil objetivo existe hasta en casa |
| Desprendible de nómina real | **Sistemas Colombia SAS (Globant), DIC-2024**, formato SAP-like con códigos de concepto | Cierra el schema de §5; **declara la cuenta de depósito** — y coincide con la del extracto (****0937): validación cruzada nueva |

### Hallazgos que ajustan el diseño (aplicados en el doc principal)

1. **Un PDF puede cubrir varios meses.** El requisito pasa de "N PDFs" a
   "ventana de N meses, en uno o varios PDFs". La validación de continuidad
   aplica igual: dentro del PDF la valida el saldo corrido; entre PDFs, saldo
   final = saldo inicial del siguiente.
2. **El independiente SÍ tiene documento de ingreso:** la factura / cuenta de
   cobro recurrente (Deel, plataformas, clientes fijos). Se acepta como
   documento opcional del independiente (2 consecutivas) y habilita el índice
   de verificación también para ese perfil — con conversión TRM si es en
   moneda extranjera.
3. **Señal nueva: aportes a seguridad social en el extracto.** Los pagos
   `PSE APORTES EN LINEA`/SOI del propio titular son un marcador de formalidad
   y estabilidad del independiente (paga su PILA él mismo).

### Rarezas de formato que el extractor DEBE tolerar (vistas en la muestra)

| Rareza | Ejemplo real | Regla para el extractor |
|--------|--------------|-------------------------|
| Fechas sin año | `1/04`, `22/06` | Resolver contra el rango DESDE/HASTA del encabezado |
| Nombre truncado | `GABRIEL GIOVANY HERRERA ZAR` | Match de identidad **difuso** contra el Customer (nunca igualdad exacta) |
| Mojibake / encoding | `Calle 54 ¥ 36E 95` (¥ en vez de #) | Normalizar; no descartar por caracteres raros |
| Columnas vacías | SUCURSAL y DCTO. casi siempre en blanco | Opcionales en el schema |
| Micro-movimientos diarios | `ABONO INTERESES AHORROS` de $0.04–$21 | Categoría `interest`, jamás contarlos como ingreso |
| Ajustes negativos de centavos | `AJUSTE INTERES AHORROS DB` −0.01 | Categoría `interest` (ajuste), ruido esperado |

---

## 2. Extracto bancario — salida del extractor

Tres bloques: cuenta, resumen y movimientos. El movimiento trae el **saldo
corrido**, que es lo que permite autovalidar la extracción fila a fila.

```jsonc
{
  "account": {
    "bank": "Bancolombia",
    "accountType": "savings",            // savings | checking | wallet
    "accountNumberLast4": "0937",
    "holderName": "GABRIEL GIOVANY HERRERA ZAR",  // tal cual aparece (puede venir truncado)
    "branch": "BARRANCABERMEJA"
  },
  "period": { "from": "2026-03-31", "to": "2026-06-30" },
  "summary": {                            // el bloque RESUMEN lo trae el banco
    "previousBalance": 7659188.84,
    "totalCredits": 56091576.83,
    "totalDebits": 59204004.65,           // valor absoluto
    "finalBalance": 4546761.02,
    "averageBalance": 1977260,            // ¡lo calcula el banco! úsese directo
    "interestPaid": 228.57,
    "withholding": 0
  },
  "movements": [
    {
      "date": "2026-04-22",               // año resuelto contra period
      "rawDescription": "TRANSF INTERNACIONAL RECIBIDA",
      "amount": 17552976.00,              // con signo (abono +, cargo −)
      "balance": 17583965.14,             // saldo corrido tras el movimiento
      "category": "income_international", // taxonomía §3
      "counterparty": null                // "NEQUI", "FINESA S.A.", etc. si se identifica
    }
  ],
  "extractionFlags": []                   // mismas flags de confiabilidad del extractor de EEFF
}
```

### Validaciones (determinísticas, en código — no en el prompt)

| # | Validación | Con la muestra |
|---|------------|----------------|
| V1 | Fila a fila: `balance[n-1] + amount[n] = balance[n]` | Verificable en todas las filas (el extracto trae saldo corrido) |
| V2 | Checksum del resumen: `previousBalance + totalCredits − totalDebits = finalBalance` | 7,659,188.84 + 56,091,576.83 − 59,204,004.65 = 4,546,761.02 ✓ exacto |
| V3 | Suma de abonos extraídos ≈ `totalCredits` (tolerancia de centavos) | Cuadró a $0.09 de diferencia (redondeos de intereses) |
| V4 | Continuidad entre PDFs: saldo final = saldo inicial del siguiente | Aplica cuando la ventana viene en varios PDFs |
| V5 | Titular ≈ identidad del Customer autorizado (difuso) | "HERRERA ZAR" debe matchear "Herrera Zárate" |
| V6 | Fechas dentro del período del encabezado | Detecta páginas de otro extracto mezcladas |

Si V1–V3 no cuadran ⇒ extracción incompleta **o documento adulterado**: el
estudio corre pero la dimensión Veracidad lo castiga y el flag lo declara.

---

## 3. Taxonomía de categorías de movimiento

La clasificación es **obligatoria** porque `TOTAL ABONOS ≠ ingreso`: en la
muestra, el 12.5% de los abonos NO era ingreso (ver §6). Categorías v1, con los
patrones reales de Bancolombia vistos en la muestra:

| Categoría | Patrones reales (Bancolombia) | Uso en indicadores |
|-----------|-------------------------------|--------------------|
| `income_international` | `TRANSF INTERNACIONAL RECIBIDA` | Ingreso |
| `income_payroll` | (nómina: `PAGO NOMINA`, `ABONO NOMINA` — pendiente muestra) | Ingreso; cruza con desprendible |
| `income_other` | Abonos recurrentes de terceros no identificados | Ingreso (menor confianza) |
| `self_transfer_in/out` | `TRANSF DE GABRIEL HER` (+6,000,000) — el nombre coincide con el titular | **Excluir del ingreso y del gasto** |
| `wallet_transfer` | `TRANSFERENCIAS A NEQUI` (decenas, $6k–$750k) | Salida a bolsillo propio probable; gasto con flag si no se aporta el extracto de la billetera |
| `cc_payment` | `PAGO SUC VIRT TC MASTER PESOS/DOLAR`, `PAGO PSE Banco de Bogota` | Servicio de deuda (tarjeta) |
| `cc_cash_in` | `TRANSFERENCIA TC SUC VIRTUAL` (+900,000) | Avance de TC: NO es ingreso; señal de estrés |
| `loan_payment` | `PAGO PSE FINESA S.A.` ($348k fijo mensual), `PAGO PSE P.A. ADDI` | **Cuota de crédito detectada** (deuda no declarada) |
| `social_security` | `PAGO PSE APORTES EN LINEA` | Formalidad del independiente |
| `pension_savings` | `PAGO PSE Multitrust SKANDIA` ($800k–1M recurrente) | Ahorro discrecional (no es deuda; reduce disponible pero es recortable) |
| `utilities` | `Electrificadora de S`, `Aguas de Barrancaber`, `GAS NATURAL DEL ORI` | Gasto fijo |
| `subscription` | `NETFLIX DL`, `PAYU*NETFL` ($39,800/mes) | Gasto fijo menor |
| `purchase` | `COMPRA EN …`, `PAGO QR …` | Gasto variable |
| `atm_withdrawal` | `RETIRO CAJERO ATM` | Gasto variable (efectivo) |
| `recurring_transfer_out` | `TRASLADO VIRTUAL OTROS BANCOS` ($1,104,600 exacto/mes), `TRANSF A GLOBAL COLOMBIA 81` ($700,000/mes) | Monto fijo mensual = obligación en otra entidad (tratar como cuota probable, con flag) |
| `bank_fee` | `C MANEJO TARJ DEB`, `COMISION TRASLADO` | Gasto fijo bancario |
| `tax` | `IMPTO GOBIERNO 4X1000`, `IVA COMIS`, `CXC IMPTO` | Fricción; excluir de gasto discrecional |
| `interest` | `ABONO INTERESES AHORROS`, `AJUSTE INTERES … DB`, `SALDO A FAVOR TARJETA CREDITO` | Ruido; nunca ingreso |
| `gambling` | (apuestas: `BETPLAY`, `WPLAY`, `RUSHBET`… — no aparece en la muestra) | Señal de riesgo §4.4 del diseño |
| `unknown` | Lo que no matchee | Flag; nunca inventar categoría |

Notas de clasificación:

- **`self_transfer`**: se detecta por similitud del contraparte con el nombre
  del titular (`TRANSF DE GABRIEL HER`). Si no se detectara, el ingreso se
  inflaría 12% en la muestra — es la regla individual más importante.
- **`recurring_transfer_out` con monto idéntico mensual** se trata como cuota
  probable: en la muestra, $1,104,600.00 exacto tres meses seguidos hacia otro
  banco no es un gasto casual.
- El prompt clasifica con la descripción + recurrencia; los patrones por banco
  se acumulan como diccionario versionado (Bancolombia primero, luego Nequi,
  Davivienda, BBVA…).

---

## 4. Factura recurrente de contratista (caso Deel) — salida del extractor

Documento de ingreso del independiente. Muestra: 2 facturas Deel consecutivas.

```jsonc
{
  "docType": "contractor_invoice",
  "invoiceNumber": "INV-nrpe53n-2026-16",
  "issueDate": "2026-08-25",
  "period": { "from": "2026-08-01", "to": "2026-08-31" },
  "contractor": { "name": "Gabriel Giovany Herrera Zarate", "phone": "+573116786056", "city": "Barrancabermeja" },
  "client": { "name": "Lean Staffing Solutions, Inc", "country": "US" },
  "role": "Full Stack Developer",
  "currency": "USD",
  "lineItems": [
    { "description": "Fixed rate: Monthly payment", "amount": 3322.00 },
    { "description": "Contractual Achievement", "amount": 400.00 }
  ],
  "total": 3729.00,
  "approvedBy": "Maria de los Angeles Hernandez (mahernandez@leangroup.com)",
  "extractionFlags": []
}
```

**Verificación cruzada contra el extracto (funciona, probada con la muestra):**
el abono `income_international` del mes debe ≈ `total USD × TRM del día del
abono − fees de la plataforma`. En la muestra los abonos (17.55M, 17.28M,
14.23M COP) son consistentes con facturas de USD 3,7xx a TRM ~4,300–4,600.
Regla: banda de tolerancia **±10%** (TRM varía + fees de Deel/Payoneer); fuera
de banda ⇒ flag de verificación, no rechazo automático.

Señales que aporta: monto fijo contractual (`Fixed rate` = piso estable del
ingreso), cliente recurrente, aprobador identificable, numeración consecutiva
de facturas (INV-…-14, INV-…-16 ⇒ una por mes).

---

## 5. Desprendible de nómina — salida del extractor

Schema cerrado contra la muestra real (Sistemas Colombia SAS / Globant,
DIC-2024, formato de códigos de concepto tipo SAP). Los formatos varían por
software de nómina (SAP, Siigo, Aleluya…), pero todos traen estos bloques por
exigencia legal:

```jsonc
{
  "docType": "payroll_stub",
  "employer": { "name": "Sistemas Colombia SAS", "nit": "900218578-7" },
  "employee": {
    "name": "Gabriel Herrera",
    "idType": "CC",
    "idNumber": "109621657-9",           // tal cual; normalizar guiones en código
    "employeeNumber": "38020079",
    "position": "WEB UI DEVELOPER, SSR",
    "division": "Santander"
  },
  "period": "2024-12",                    // formato origen: "DIC-2024"
  "hireDate": "2024-07-22",               // ⭐ antigüedad VERIFICADA (mejor que declarada)
  "baseSalary": 8150000.00,
  "funds": { "health": "SANITAS", "pension": "SKANDIA", "severance": "PORVENIR" },
  "depositAccount": {                     // ⭐ dónde le consignan — cruza con el extracto
    "bank": "Bancolombia",
    "accountType": "02",                  // 02 = ahorros
    "accountNumberLast4": "0937"
  },
  "concepts": [
    { "code": "M010", "concept": "Sueldo Básico", "quantity": 28.0, "earning": 7606667, "deduction": null },
    { "code": "9730", "concept": "Vacaciones Días Hábiles", "quantity": 2.0, "earning": 543334, "deduction": null },
    { "code": "BN07", "concept": "Medicina Prepa Colsanitas", "quantity": 0, "earning": 637200, "deduction": null },
    { "code": "2T40", "concept": "COLSANITAS", "quantity": 0, "earning": null, "deduction": 637200 },
    { "code": "T000", "concept": "Descuento Salud", "quantity": 30.0, "earning": null, "deduction": 333201 },
    { "code": "T050", "concept": "Retención en la Fuente", "quantity": 8.36, "earning": null, "deduction": 393000 }
    // ... todos los renglones, tal cual aparecen
  ],
  "totals": { "earnings": 9487619, "deductions": 1785320 },
  "netPay": 7702299,
  "netPayInWords": "SIETE MILLONES SETECIENTOS DOS MIL DOSCIENTOS NOVENTA Y NUEVE PESOS",
  "signature": { "signed": true, "timestamp": "2025-02-03T08:59:14-05:00" },  // "FIRMADO CONFORME"
  "extractionFlags": []
}
```

### Clasificación de conceptos (en código, sobre los renglones extraídos)

La lectura del desprendible NO es "devengos − deducciones" a secas; cada
concepto se clasifica para que los indicadores no se distorsionen:

| Clase | Ejemplos de la muestra | Regla |
|-------|------------------------|-------|
| `salary` | Sueldo Básico, Bono Proyectos | Ingreso recurrente |
| `seasonal` | Prima Legal, Vacaciones | **No proyectar como ingreso mensual**: un desprendible de jun/dic infla el ingreso (prima). Flag si el período es junio o diciembre |
| `statutory_deduction` | Descuento Salud, Pensión, Solidaridad, Retefuente | Descuentos de ley (base del cupo Ley 1527) |
| `flex_benefit_mirror` | Colsanitas $637,200 y Seguro Bolívar $5,417 — aparecen **como devengo Y como deducción por el mismo valor** | Beneficio flexible: se netean; NO cuentan como "otra deducción" (inflarían el endeudamiento y comerían cupo de libranza falso) |
| `libranza` | (no hay en la muestra: `Libranza Banco X`) | Deuda por descuento directo — consume cupo Ley 1527 |
| `garnishment` | (no hay en la muestra: `Embargo Juzgado X`) | ⭐ La respuesta documental a "¿está embargada?" |
| `other_deduction` | Fondo de empleados, sindicato… | Reduce el disponible |

Cupo de libranza con estas clases:
`0.5 × (devengos_salariales − statutory_deductions) − (libranzas + embargos existentes)`.

### Validaciones nuevas que habilita la muestra

| # | Validación | Con la muestra |
|---|------------|----------------|
| V7 | **Cuenta de depósito del desprendible = cuenta del extracto** (cuando ambos se aportan) | ****0937 = ****0937 ✓ — prueba que el extracto analizado es donde cae la nómina. La validación anti-fraude más fuerte del set |
| V8 | Checksum del neto: `totals.earnings − totals.deductions = netPay` | 9,487,619 − 1,785,320 = 7,702,299 ✓ exacto |
| V9 | Neto en letras = neto en número | "SIETE MILLONES SETECIENTOS DOS MIL…" ✓ (dos representaciones que un editor de PDF descuidado no cambia juntas) |
| V10 | Conceptos espejo cuadran (devengo = deducción del mismo beneficio) | Colsanitas y Seg. Bolívar ✓ |

### Rarezas de formato vistas en la muestra (further reading para el prompt)

- **Dos formatos numéricos en el MISMO documento**: `8150000.00` (punto
  decimal, en el encabezado) vs `7.606.667,00` (formato colombiano, en la
  tabla). El extractor no puede asumir un solo locale por documento.
- La cédula viene con sufijo (`109621657-9`): normalizar en código, no en el
  prompt.
- `CANTIDAD` mezcla unidades: días (28, 30), días hábiles (2.00), factores
  (1.33, 8.36) — extraer tal cual, sin interpretar.
- Nombre en forma corta ("Gabriel Herrera") vs extracto ("GABRIEL GIOVANY
  HERRERA ZAR"): otra razón para el match difuso de identidad (V5).
- Firma electrónica con timestamp (`FIRMADO CONFORME`): señal de autenticidad
  cuando existe; su ausencia no penaliza (no todos los software la traen).

---

## 6. Ejemplo trabajado con la muestra real

Lo que el estudio habría producido con estos documentos (perfil: independiente,
contratista remoto):

**Ingreso** — 3 abonos internacionales: $17,552,976 (22/04), $17,282,552
(21/05), $14,234,628 (23/06). Promedio **$16.36M/mes**, CV ≈ 9% (estable), 3/3
meses con ingreso. Verificado contra facturas Deel ✓. Los abonos NO-ingreso
excluidos: $6M transferencia propia + $900k avance TC + $120k + intereses =
$7.02M (12.5% del total de abonos).

**Obligaciones detectadas** — cuota fija FINESA ≈ $348.6k/mes (crédito activo);
ADDI $735k–$1M (BNPL); pagos de TC Master intensivos ($14.4M en abril, $4.1M en
mayo, $3.7M en junio); $1.10M/mes exacto hacia otro banco + $700k/mes a Global
Colombia (obligaciones probables). Ahorro Skandia $800k–$1.8M/mes (discrecional,
no deuda). Servicios ≈ $570k/mes. PILA propia ✓ (formalidad).

**Comportamiento** — saldo promedio $1.98M (el banco lo da) vs ingreso de
$16.4M: colchón bajo. Saldo en $0.00 exacto el 28/04; **negativo ~7 días en
mayo y ~12 días en junio** (la cuota de manejo lo dejó en rojo hasta el abono
siguiente). Patrón: un solo abono mensual (día 21–23) y agotamiento casi total
antes del siguiente. Decenas de transferencias a Nequi (bolsillo no visible:
flag por extracto de billetera no aportado).

**Lectura**: ingreso alto y estable + endeudamiento de consumo alto + colchón
mínimo con días en negativo ⇒ capacidad de pago buena pero sensible; la cuota
máxima saldría del disponible real, no del ingreso bruto — exactamente lo que
el indicador compuesto (30% neto / 70% disponible) está diseñado a capturar.

---

## 7. Implicaciones para los prompts del extractor

1. **Una pasada por página, saldo corrido incluido**: el saldo es lo que
   permite validar; jamás extraer solo montos sin saldo.
2. **No calcular, extraer**: totales y promedios vienen en el RESUMEN; los
   indicadores se calculan en código sobre los movimientos, nunca en el prompt.
3. **Categoría con recurrencia**: la clasificación fina (cuota vs gasto) usa
   la repetición del monto/contraparte entre meses — eso se decide en código;
   el prompt solo etiqueta la categoría base + contraparte.
4. **`unknown` es respuesta válida**: prohibido inventar categoría o
   contraparte; un `unknown` con flag vale más que una alucinación.
5. **Fechas**: siempre resolver el año contra el período del encabezado.
6. **Identidad**: extraer el titular tal cual (truncado y todo); el match
   difuso contra el Customer es responsabilidad del código.
7. Mismo mecanismo de `extractionFlags` del extractor de EEFF (confiabilidad
   por campo), reutilizado tal cual.
