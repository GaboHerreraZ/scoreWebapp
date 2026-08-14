# Facturación electrónica — diseño de integración (agnóstica al proveedor)

Estado: **propuesta** (nada implementado todavía).
Proveedor evaluado: **Aliaddo Nitro**. Objetivo: que cambiar de proveedor mañana
(Alegra, Factus, Siigo, Dataico…) toque **una sola carpeta**.

---

## 1. De dónde partimos (lo que YA existe)

La facturación hoy es **manual** y el andamiaje está construido:

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Desglose fiscal congelado | `AnalysisPack.taxRatePaid / taxBase / taxAmount / totalPaid / currencyCode` | Se congela al cobrar. Invariante: `totalPaid = taxBase + taxAmount` |
| Datos fiscales del cliente | `Company.billing*` (razón social, docType, docNumber, email, dirección, ciudad, depto, teléfono) | Se capturan en el onboarding |
| Cola de facturación | `admin.service.ts:1240+`, `GET/PATCH/DELETE /admin/einvoices` | Lista ventas pagadas sin facturar; un admin emite **por fuera** y marca el número a mano |
| Marca de emitida | `AnalysisPack.einvoiceSent / einvoiceSentAt / einvoiceNumber / einvoiceMarkedBy` | Estado manual |
| Disparador de la venta | `analysis-packs.service.ts` → `notifyPurchasePaid(pack)` cuando `activated === true` | Notifica a los admins que hay algo que facturar |
| Índice de la cola | `@@index([einvoiceSent, paidAt])` | Ya optimizado para esto |

**Conclusión:** no hay que inventar el flujo de negocio, ya está. La integración
**sustituye el paso manual** por una emisión automática y deja la marca manual
como salida de emergencia.

---

## 2. Aliaddo expone DOS APIs distintas — hay que elegir

Ambas viven en `docs.aliaddo.com` y se confunden fácil. No son versiones: son
productos con modelos de responsabilidad opuestos.

| | **A · Integradores Nitro (facturación masiva)** | **B · Nitro (cuenta Aliaddo)** |
|---|---|---|
| Endpoint | `POST https://nitro.aliaddo.net/v2/documents/invoices` | `POST https://nitro.aliaddo.net/invoices` |
| Doc | [crear-factura-electrónica-36440739e0](https://docs.aliaddo.com/crear-factura-electr%C3%B3nica-36440739e0) | [crear-factura-de-venta-36444000e0](https://docs.aliaddo.com/crear-factura-de-venta-36444000e0) |
| Payload | **Documento fiscal completo**: `resolution`, `branch`, `customer`, `lines`, `taxes`, `totals` | **Referencias a maestros de Aliaddo**: `personId`, `branchId`, `itemCode`, `taxes[].id` |
| Resolución DIAN | **La enviamos nosotros** (`key` = clave técnica, `prefix`, rangos, vigencia) | La configura Aliaddo en la cuenta |
| Consecutivo | **Lo llevamos nosotros** (`consecutive`, entero) | Lo asigna Aliaddo (devuelve `consecutive`) |
| Maestros (terceros/ítems) | No existen: todo va en el request | Hay que **crearlos/sincronizarlos** antes de facturar |
| Ambientes | `mode: Test / Habilitation (testSetId) / Production` | Cuenta de pruebas vs producción |
| Respuesta | `Id`, `Cufe`, `Sequence`, `Qr`, `Status`, `StatusReasons` | `id`, `consecutive`, `cufe`, `qr`, `status`, `statusDian`, `stateDian`, `urlPdf` |
| Auth | `Authorization: Bearer <token>` (portal → Integración → generar token) | Igual |
| Códigos HTTP | 200 / 400 / 401 / 403 / 404 / 422 / 429 / 500 / 520 | Igual |

### Recomendación

**Arrancar con B, con el puerto diseñado para soportar A sin tocar el dominio.**

Por qué:

- **B nos saca de encima toda la superficie DIAN riesgosa**: resolución, clave
  técnica, rangos, consecutivos atómicos, contingencia y habilitación las lleva
  Aliaddo. Con A, un bug de concurrencia en el consecutivo = facturas duplicadas
  ante la DIAN, y eso se corrige con notas crédito y llamadas a la DIAN.
- El volumen es bajo (una factura por compra de bolsa). A está pensado para
  facturación masiva de un integrador que factura **a nombre de terceros**; no es
  nuestro caso: Creditia (RUSER CONSULTORES S.A.S., NIT 901691260) factura a
  nombre propio.
- La sincronización de maestros (`personId`, `itemCode`) que exige B **es un
  detalle del adaptador**, no del dominio: se resuelve con una tabla genérica de
  referencias externas (§5) y no se filtra al `service`.

A conviene si mañana Creditia quiere emitir facturas **de sus clientes** (que
cada empresa facture a sus deudores desde la plataforma). Hoy `InvoiceDocument`
NO lleva emisor: como siempre factura Creditia, se dejó que el proveedor lo
resuelva desde la empresa configurada en su cuenta (`branch` es opcional en el
payload). Para emitir a nombre de terceros habría que reintroducir
`issuer: InvoiceParty` en el documento y mapearlo en el adaptador.

> ⚠️ Esta decisión hay que confirmarla con el comercial de Aliaddo: **qué API
> incluye el contrato** y si el plan permite ambas. Todo lo demás del diseño es
> idéntico en los dos casos.

---

## 3. ¿Módulo aparte? Sí

`src/e-invoicing/`. Razones:

1. **Es un dominio propio, no un atributo de la bolsa.** Un documento fiscal
   tiene ciclo de vida propio (pendiente → enviado → aceptado/rechazado →
   anulado por nota crédito), reintentos, consultas de estado y numeración. Meter
   eso en `analysis-packs` infla un módulo que ya tiene compra, webhook, promos,
   consumo y alertas.
2. **Va a tener más de un consumidor.** Hoy lo dispara la compra de bolsas;
   mañana, ajustes manuales, reversas (nota crédito) o cualquier otro cobro.
3. **Es el mismo patrón que ya validamos con DataCrédito** (`credit-bureau`):
   módulo + puerto + adaptador. Consistencia > novedad.
4. `admin` sigue siendo **solo la UI**: consulta y dispara, no conoce a Aliaddo.

---

## 4. Arquitectura — 3 capas, igual que `credit-bureau`

```
src/e-invoicing/
├── e-invoicing.module.ts            # { provide: E_INVOICE_PROVIDER, useClass: AliaddoProvider }
├── e-invoicing.service.ts           # orquesta: arma el documento de dominio, llama al puerto, persiste
├── e-invoicing.repository.ts        # Prisma
├── e-invoicing.controller.ts        # admin: emitir, reintentar, consultar estado, nota crédito
├── domain/
│   ├── invoice-document.ts          # tipos NEUTROS del dominio
│   ├── dian.catalogs.ts             # códigos DIAN (nacionales, NO del proveedor)
│   └── verification-digit.ts        # cálculo del DV del NIT (algoritmo DIAN)
├── providers/
│   ├── e-invoice-provider.interface.ts
│   └── aliaddo.provider.ts          # implementa el puerto; orquesta client + mapper
├── aliaddo/
│   ├── aliaddo.client.ts            # HTTP puro: base URL, token, timeouts, errores
│   ├── aliaddo.mapper.ts            # dominio → payload Aliaddo; respuesta → dominio
│   ├── aliaddo.catalogs.ts          # traducciones específicas del proveedor
│   └── aliaddo.types.ts             # tipos crudos del proveedor
└── dto/
```

### Regla de oro (la que hizo funcionar DataCrédito)

**Ningún tipo de `aliaddo/` cruza fuera de esa carpeta.** El `service` solo
conoce `InvoiceDocument` y `EInvoiceResult`. Cambiar de proveedor = escribir una
carpeta nueva y cambiar **una línea** en el módulo.

Matiz importante: **los códigos DIAN no son del proveedor.** Tipos de
identificación, responsabilidades fiscales, régimen, medios de pago, códigos DANE
y unidades de medida son estándar nacional — cualquier proveedor colombiano usa
los mismos. Por eso van en `domain/dian.catalogs.ts`, no en `aliaddo/`. En
`aliaddo/aliaddo.catalogs.ts` solo va lo que Aliaddo se inventó (nombres de
campos, `mode`, `format`, sus enums propios).

### El puerto

```ts
export const E_INVOICE_PROVIDER = Symbol('E_INVOICE_PROVIDER');

export interface IEInvoiceProvider {
  readonly name: string;

  /** Emite una factura de venta. El adaptador resuelve internamente lo que su
   *  proveedor necesite (crear el tercero, el ítem, etc.). */
  issueInvoice(doc: InvoiceDocument): Promise<EInvoiceResult>;

  /** Nota crédito sobre una factura ya emitida (anulación / devolución). */
  issueCreditNote(doc: CreditNoteDocument): Promise<EInvoiceResult>;

  /** Reconsulta el estado ante la DIAN (para documentos que quedaron 'pending'). */
  getStatus(ref: EInvoiceRef): Promise<EInvoiceStatus>;
}
```

```ts
export interface EInvoiceResult {
  status: 'accepted' | 'rejected' | 'pending';
  statusReasons: string[];        // motivos DIAN (por qué rechazó)
  externalId: string | null;      // id del documento en el proveedor
  number: string | null;          // "SETP994121930" (prefijo + consecutivo)
  prefix: string | null;
  consecutive: number | null;
  cufe: string | null;
  qrData: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  httpStatus: number;
  raw: unknown;                   // respuesta CRUDA completa, para archivar
}
```

`InvoiceDocument` (dominio, neutro):

```ts
interface InvoiceDocument {
  // sin emisor: lo aporta el proveedor desde la empresa que tiene configurada
  customer: InvoiceParty;         // desde Company.billing*
  issueDate: Date;
  dueDate: Date;
  paymentMeanCode: string;        // catálogo DIAN
  paymentFormCode: 'cash' | 'credit';
  currency: string;               // 'COP'
  lines: InvoiceLine[];
  notes: string[];
  reference: string | null;       // nuestro id de bolsa, para trazabilidad
}

interface InvoiceParty {
  legalName: string;
  firstName: string | null;
  lastName: string | null;
  identificationTypeCode: string; // código DIAN ('31' NIT, '13' CC…)
  identificationNumber: string;
  verificationDigit: string | null;
  personType: 'legal' | 'natural';
  regimeCode: string;             // '48' responsable IVA / '49' no responsable
  fiscalResponsibilities: string[];
  email: string | null;
  phone: string | null;
  address: InvoiceAddress;
}

interface InvoiceLine {
  code: string;                   // 'PACK-CONSULTAS'
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;              // antes de impuestos
  unitMeasurementCode: string;    // '94' unidad
  standardCode: string | null;    // UNSPSC
  taxes: InvoiceTax[];            // { code: '01' IVA, rate, base, amount }
  discounts: InvoiceDiscount[];
}
```

Como en DataCrédito, **se archiva siempre el `raw`** de la respuesta: es la
evidencia ante la DIAN y ante el cliente.

---

## 5. Modelo de datos

### `ElectronicInvoice` (nuevo)

```prisma
model ElectronicInvoice {
  id             String  @id @default(uuid()) @db.Uuid
  companyId      String  @map("company_id") @db.Uuid
  analysisPackId String? @map("analysis_pack_id") @db.Uuid  // origen del cobro

  documentTypeId Int     @map("document_type_id")  // Parameter 'einvoice_document_type': invoice | credit_note
  statusId       Int     @map("status_id")         // Parameter 'einvoice_status': pending | sending | accepted | rejected | cancelled

  provider    String @default("aliaddo") @db.VarChar(50)
  environment String @db.VarChar(20)   // test | habilitation | production

  // Identificación fiscal del documento
  prefix      String?   @db.VarChar(10)
  consecutive Int?
  number      String?   @db.VarChar(50)   // "SETP994121930"
  issueDate   DateTime  @map("issue_date") @db.Date
  dueDate     DateTime  @map("due_date") @db.Date

  // Snapshot CONGELADO de lo facturado (la Company puede cambiar después)
  customerSnapshot Json  @map("customer_snapshot") @db.JsonB
  linesSnapshot    Json  @map("lines_snapshot") @db.JsonB
  currencyCode String @default("COP") @map("currency_code") @db.VarChar(10)
  taxBase      Float  @map("tax_base")
  taxAmount    Float  @map("tax_amount")
  total        Float

  // Resultado del proveedor / DIAN
  providerDocumentId String? @map("provider_document_id") @db.VarChar(100)
  cufe               String? @db.VarChar(200)
  qrData             String? @map("qr_data") @db.Text
  pdfUrl             String? @map("pdf_url") @db.Text
  xmlUrl             String? @map("xml_url") @db.Text
  statusReasons      Json?   @map("status_reasons") @db.JsonB

  // Operación
  attempts   Int       @default(0)
  lastError  String?   @map("last_error") @db.VarChar(500)
  sentAt     DateTime? @map("sent_at")
  acceptedAt DateTime? @map("accepted_at")
  rawRequest  Json? @map("raw_request") @db.JsonB
  rawResponse Json? @map("raw_response") @db.JsonB

  relatedInvoiceId String? @map("related_invoice_id") @db.Uuid // nota crédito → factura

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([statusId, createdAt])
  @@index([companyId, createdAt])
  @@map("electronic_invoices")
}
```

**Idempotencia:** índice único parcial sobre `analysis_pack_id` para
`document_type = invoice` y estado ≠ `rejected/cancelled` → un webhook repetido
**no puede** emitir dos facturas de la misma venta. (En Prisma se declara como
índice normal y el único parcial se agrega a mano en el SQL de la migración,
igual que otros índices del proyecto.)

### `EInvoiceProviderRef` (solo si vamos con la API B)

Aliaddo B exige `personId` / `itemCode` de sus maestros. En vez de ensuciar
`Company` con una columna `aliaddoPersonId`, una tabla genérica:

```prisma
model EInvoiceProviderRef {
  id         String @id @default(uuid()) @db.Uuid
  provider   String @db.VarChar(50)   // 'aliaddo'
  entityType String @map("entity_type") @db.VarChar(50)  // 'company' | 'item' | 'branch'
  entityId   String @map("entity_id") @db.VarChar(100)   // uuid de Company, o 'PACK-CONSULTAS'
  externalId String @map("external_id") @db.VarChar(100)
  ...
  @@unique([provider, entityType, entityId])
  @@map("einvoice_provider_refs")
}
```

Vive **dentro del módulo** y solo la usa el adaptador. Si cambiamos de proveedor
que no necesite maestros, la tabla simplemente queda sin uso.

### `EInvoiceSequence` + `EInvoiceResolution` (solo si vamos con la API A)

Numeración propia. Requiere incremento **atómico** (`UPDATE … SET next = next + 1
RETURNING next`, nunca leer-y-escribir). Y alertas cuando quede poco rango o poca
vigencia. Es la razón principal para preferir B.

### Lo que NO cambia

Los campos `einvoice*` de `AnalysisPack` **se quedan**: pasan a ser un
denormalizado que llena el módulo al aceptar la factura, y mantienen viva la cola
del panel admin y la marca manual como escape hatch.

---

## 6. Quién es el adquirente: persona natural y jurídica

El comprador de la bolsa siempre es una `Company` en nuestro modelo, pero la
**identidad fiscal** que va en la factura sale de `Company.billing*`, que ya
distingue los dos casos desde el onboarding:

| | Persona jurídica | Persona natural |
|---|---|---|
| Nombre en la factura | `billingBusinessName` (razón social) | `billingName` + `billingLastName` |
| Documento | `billingDocTypeId` = `nit` | `cc`, `ce`, `pas`… |
| `personType` DIAN | `1` (jurídica) | `2` (natural) |
| `regimeType` típico | `48` responsable de IVA | `49` no responsable |
| `responsibilities` típico | `O-13` / `O-15` / `O-23` / `O-47` según el caso | `R-99-PN` |
| `digitCheck` | calculado sobre el NIT | vacío |

**No hay que capturar nada nuevo para distinguirlos**: se deriva del tipo de
documento. Lo que sí falta capturar es el régimen y las responsabilidades
(§7), porque no se pueden adivinar — una persona natural puede ser responsable
de IVA y una jurídica puede ser del régimen simple.

### Mapeo del catálogo propio → DIAN

Nuestro `Parameter 'identification_type'` ya cubre todo lo que la DIAN acepta.
El mapa va en `domain/dian.catalogs.ts`:

| `parameter.code` | Label | Código DIAN |
|---|---|---|
| `cc` | Cédula de Ciudadanía | `13` |
| `nit` | NIT | `31` |
| `ce` | Cédula de Extranjería | `22` |
| `pas` | Pasaporte | `41` |
| `ti` | Tarjeta de Identidad | `12` |
| `ppt` | Permiso por Protección Temporal | `48` |
| `pep` | Permiso Especial de Permanencia | `47` |
| `dni` | Documento Nacional de Identidad | `42` |
| `pje` | Persona jurídica del extranjero | `50` |

Régimen: `48` = responsable de IVA · `49` = no responsable.
Responsabilidades: `O-13` gran contribuyente · `O-15` autorretenedor · `O-23`
agente de retención IVA · `O-47` régimen simple · `R-99-PN` no aplica.
Campo complementario `responsibleFor`: `01` IVA · `04` INC · `ZA` IVA e INC ·
`ZZ` no aplica.

> El catálogo de responsabilidades dice que van **como arreglo**, pero el ejemplo
> del endpoint las manda como string (`"responsibilities": "R-99-PN"`). Verificar
> contra el sandbox antes de dar por buena cualquiera de las dos formas.

## 7. Datos que HOY nos faltan (el trabajo real)

Esto es lo que hace que una factura sea rechazada por la DIAN, y es la mitad del
esfuerzo del proyecto:

| Campo exigido | Hoy | Qué hacer |
|---|---|---|
| `identificationTypeCode` (DIAN) | `Company.billingDocTypeId` → `Parameter` | Mapa `parameter.code → código DIAN` en `dian.catalogs.ts` |
| `digitCheck` (DV del NIT) | no existe | **Calcularlo** con el algoritmo DIAN (`verification-digit.ts`). No almacenar |
| `personType` (jurídica/natural) | derivable del tipo de doc | Explicitarlo; NIT → jurídica, CC/CE → natural |
| `regimeType` (`48`/`49`) | **no existe** | Nueva columna `Company.billingRegimeTypeId` + `Parameter 'tax_regime'` |
| `responsibilities` (`O-13`, `R-99-PN`…) | **no existe** | Nueva columna `Company.billingFiscalResponsibilities` + `Parameter 'fiscal_responsibility'` |
| `regionCode` / `cityCode` **DANE** | `billingState` / `billingCity` son **texto libre** | Catálogo DANE propio + FK en `Company` — **ver §7.1** |
| `email` del adquirente | `billingEmail` ✔ | Volverlo **obligatorio** para facturar (la DIAN exige entrega) |
| `unitMeasurementCode` | — | Constante `'94'` (unidad) |
| `standardCode` (UNSPSC) | — | Constante del servicio, definir una vez |
| Código del ítem | — | Constante `'PACK-CONSULTAS'` |

**Consecuencia de producto:** una empresa no debería poder comprar sin datos
fiscales completos, o vamos a acumular ventas cobradas e imposibles de facturar.
Recomiendo validar en el checkout (`purchase`) **antes** de crear la sesión de
pago, no al momento de facturar.

### 7.1 El catálogo de ciudades — el gap más grande

El catálogo de Aliaddo es el DANE estándar: **1.123 municipios** y **33
departamentos**. Reglas del formato:

- `cityCode` = 5 dígitos (`11001` Bogotá, `68001` Bucaramanga, `05001` Medellín).
- `regionCode` = 2 dígitos = **los dos primeros de `cityCode`**. Aliaddo valida
  la coherencia y rechaza el documento si no casan.
- En el catálogo los nombres traen el departamento abreviado (`Medellín (ANT)`),
  pero los ejemplos del endpoint mandan el nombre limpio (`"cityName": "Bogotá"`).
  El sufijo existe porque **66 nombres de municipio están repetidos** entre
  departamentos (`05059 Armenia (ANT)` vs `63001 Armenia (QUI)`). Verificar
  contra el sandbox qué forma exacta espera `cityName`.

#### Hallazgo: el front ya tiene los selectores, pero contra una API externa

`state-control.ts` y `city-control.ts` (webApp) alimentan los desplegables desde
**`https://api-colombia.com`**, un servicio público de terceros. Tres problemas,
y ninguno es menor:

1. **Los `id` no son códigos DANE.** api-colombia devuelve su id interno
   (Arauca = `3`, no `81`). Lo que el usuario elige **no sirve** para la DIAN.
2. **El backend ni siquiera los guarda**: `billingState` / `billingCity` son
   `VarChar` con el nombre. El código se pierde en el camino.
3. **Es una dependencia externa dentro del flujo de compra.** Si api-colombia
   está caída o cambia, nadie puede completar sus datos de facturación. No hay
   fallback ni caché.

Los nombres tampoco coinciden literalmente (`Bogotá D.C.` en api-colombia vs
`Bogotá, D.c.` en el catálogo DIAN), así que un match por texto no basta.

#### Estado: catálogo propio ✅ implementado (staging)

Tablas `dane_regions` (33) + `dane_cities` (1.123), servidas por el módulo
`src/locations/`. No van como `Parameter`: son 1.156 filas con código propio y
jerarquía, no un lookup de configuración.

| | |
|---|---|
| Esquema | `prisma/migrations/20260813120000_add_dane_catalog` |
| Semilla | `prisma/data/v006/01_dane_catalog.sql` (idempotente, `ON CONFLICT DO UPDATE`) |
| API | `GET /api/locations/regions`, `/regions/:code/cities`, `/cities?search=`, `/cities/:code` |
| Caché | `CacheInterceptor` con TTL de 24 h (el catálogo casi no cambia) |

**Fuente del seed: el catálogo del proveedor de facturación, NO DIVIPOLA del
DANE.** Difieren en 3 municipios y quien rechaza el documento es la DIAN:

| | |
|---|---|
| Solo en DIAN | `27086` Belén de Bajira (CHO), `94663` Mapiripana (GUA) |
| Solo en DANE | `27493` Nuevo Belén de Bajirá |

DIVIPOLA (`https://www.datos.gov.co/resource/gdxc-w37w.json`, Socrata, sin auth)
queda como fuente de contraste para cuando el DANE actualice — nunca como
llamada en caliente.

`DaneCity` guarda dos nombres:

- `dianName` — el exacto del catálogo (`'Bogotá, D.c.'`). Es el que viaja en el
  `cityName` de la factura; la DIAN valida que corresponda al código.
- `name` — el mismo normalizado para los desplegables (`'Bogotá D.C.'`,
  `'Santa Fé de Antioquia'`).

Invariante verificada en staging: **0 filas** donde los 2 primeros dígitos del
municipio no coincidan con su departamento.

#### Lo que falta de esta pieza

1. `Company.billingCityCode` como FK a `dane_cities`. El `regionCode` se deriva
   —no se guarda dos veces— y `billingState`/`billingCity` se conservan como
   texto hasta terminar la migración de los datos viejos.
2. Migrar las empresas existentes: normalizar (minúsculas, sin tildes) y hacer
   match por nombre dentro del departamento; los que no casen, a mano.
3. Cambiar `city-control` / `state-control` (webApp) para que consuman
   `/api/locations/...` en vez de api-colombia. Son 4 pantallas: onboarding,
   formulario de facturación, ficha de cliente y estudio de crédito.

---

## 8. Flujo de emisión

```
webhook ePayco (cod_response = 1)
  → activateAfterConfirmation() → activated = true
      ├─ markOnboardingReady()          (ya existe)
      ├─ sendContractForCompany()       (ya existe)
      ├─ notifyPurchasePaid()           (ya existe)
      └─ eInvoicingService.issueForPack(pack.id)   ← NUEVO, best-effort
             ├─ crea ElectronicInvoice 'pending'  (único por pack → idempotente)
             ├─ arma InvoiceDocument desde Company.billing* + montos congelados
             ├─ provider.issueInvoice(doc)
             ├─ accepted → guarda cufe/pdf, marca AnalysisPack.einvoiceSent,
             │             envía el PDF a billingEmail (mail.service ya existe)
             └─ rejected/error → attempts++, lastError, alerta al admin
```

Se engancha **con el mismo patrón `try/catch` best-effort** que ya usan
`markOnboardingReady` y `sendContractForCompany`: un fallo facturando **jamás**
puede tumbar el webhook ni impedir que la bolsa quede activa. El cliente ya pagó;
la factura se resuelve después.

**Reintentos:** el proyecto **no tiene `@nestjs/schedule`** (no hay cron). Fase 1:
reintento **manual** desde el panel + alerta visible. Si se quiere automático,
hay que agregar la dependencia — decisión aparte, no la doy por hecha.

---

## 9. Panel admin

La cola actual (`GET /admin/einvoices`) cambia de **"marcar a mano"** a
**"monitorear"**. Se agregan:

- `POST /admin/einvoices/:packId/issue` — emitir (útil en fase 2, antes de
  automatizar, y para las ventas viejas ya cobradas)
- `POST /admin/einvoices/:id/retry` — reintentar una rechazada
- `GET  /admin/einvoices/:id` — motivos de rechazo, PDF, XML, CUFE, payload crudo
- `POST /admin/einvoices/:id/credit-note` — anular con nota crédito

El `PATCH` manual actual **se conserva**: sirve para facturas emitidas fuera del
sistema y para el histórico.

---

## 10. Variables de entorno

Dos grupos: los del **dominio** (sin prefijo, sobreviven a un cambio de
proveedor) y los del **adaptador** (prefijados, se van con él).

```
# Dominio — no cambian si mañana el proveedor es otro
EINVOICE_PROVIDER=aliaddo          # cuál adaptador inyectar
EINVOICE_ENABLED=false             # kill switch: en false registra, no envía
EINVOICE_ENVIRONMENT=test          # test | habilitation | production

# Adaptador Aliaddo
ALIADDO_API_URL=https://nitro.aliaddo.net
ALIADDO_TOKEN=...                  # portal Aliaddo → Integración → generar token
ALIADDO_TEST_SET_ID=...            # solo cuando el ambiente es habilitation
```

`EINVOICE_ENVIRONMENT` es concepto del DOMINIO, no del proveedor: los tres
ambientes son de la DIAN y existen en cualquier proveedor colombiano. El
adaptador lo traduce a su enum (`test` → `"Test"`) en `toAliaddoMode`.

**No tiene default.** Un valor desconocido revienta al arrancar
(`parseInvoiceEnvironment`), en vez de caer a `test`: un typo que degrade
producción a pruebas emitiría documentos sin validez legal creyendo que factura
de verdad, y nadie se enteraría hasta que la DIAN reclame.

Son DOS interruptores distintos:

| | |
|---|---|
| `EINVOICE_ENVIRONMENT` | a cuál ambiente DIAN se emite. `test` sí llega al proveedor, pero el documento no tiene efectos legales |
| `EINVOICE_ENABLED` | si se envía o no. En `false` la factura queda registrada como pendiente y nunca sale |

Para probar en staging: `EINVOICE_ENVIRONMENT=test` + `EINVOICE_ENABLED=true`.

`.env.staging` → `test`; `.env` → `production`. El token **no expira**
documentadamente, pero es revocable desde el portal: tratarlo como secreto
rotable (igual que las credenciales de Experian).

---

## 11. Fases

| Fase | Qué | Bloquea a |
|---|---|---|
| **F0 · Negocio** (sin código) | Resolución DIAN de Creditia, contrato/cuenta Aliaddo, definir responsabilidades fiscales y régimen de Creditia, habilitación DIAN si aplica | Todo |
| **F1 · Datos** | Migración: `billingRegimeTypeId`, `billingFiscalResponsibilities`, FK a catálogo DANE; sembrar parámetros; migrar ciudades texto→código; validación de datos fiscales en el checkout; formulario en `webApp` | F2 |
| **F2 · Módulo** | `e-invoicing` completo: puerto, adaptador Aliaddo, modelo, emisión **manual desde admin en modo Test** | F3 |
| **F3 · Automatización** | Enganche en el webhook, correo con PDF al cliente, alertas de rechazo, panel de monitoreo | — |
| **F4 · Ciclo completo** | Notas crédito (reversas/anulaciones), reconsulta de estado, contingencia | — |

F1 se puede empezar **hoy mismo**: no depende de qué API de Aliaddo se elija ni de
la resolución DIAN.

---

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Datos fiscales incompletos → rechazo DIAN | Validar **antes de cobrar**, no antes de facturar |
| Doble emisión por webhook repetido | Único parcial sobre `analysis_pack_id` + claim atómico de estado |
| Consecutivo duplicado (solo API A) | `UPDATE … RETURNING` atómico; o elegir la API B y que lo lleve Aliaddo |
| DIAN caída | Estado `pending` + reconsulta; Aliaddo documenta [modo contingencia](https://docs.aliaddo.com/modo-contingencia-2171116m0) |
| Cambio de proveedor | Solo se reescribe `aliaddo/` + una línea del módulo. El dominio y la BD no se tocan |
| Rate limit (429) | Backoff en `aliaddo.client.ts`; el volumen es bajo, no debería aparecer |

---

## Referencias

- [Introducción — API Integradores Nitro](https://docs.aliaddo.com/introducci%C3%B3n-2171085m0)
- [Autenticación (API A)](https://docs.aliaddo.com/autenticaci%C3%B3n-2171086m0) · [Autenticación (API B)](https://docs.aliaddo.com/autenticaci%C3%B3n-2248457m0)
- [Crear factura electrónica (API A)](https://docs.aliaddo.com/crear-factura-electr%C3%B3nica-36440739e0)
- [Crear factura de venta (API B)](https://docs.aliaddo.com/crear-factura-de-venta-36444000e0)
- [Códigos de respuesta](https://docs.aliaddo.com/c%C3%B3digos-de-respuesta-de-la-api-2171087m0) · [Límite de request](https://docs.aliaddo.com/l%C3%ADmite-de-request-2248565m0)
- Catálogos DIAN: [tipos de identificación](https://docs.aliaddo.com/tipos-de-identificacion-2171097m0) · [tipos de persona](https://docs.aliaddo.com/tipos-de-persona-2171100m0) · [tipos de régimen](https://docs.aliaddo.com/tipos-de-regimen-2171101m0) · [responsabilidades fiscales](https://docs.aliaddo.com/responsabilidades-fiscales-2171096m0) · [medios de pago](https://docs.aliaddo.com/medios-de-pagos-2171094m0) · [ciudades](https://docs.aliaddo.com/ciudades-2171089m0) · [departamentos](https://docs.aliaddo.com/departamentos-2171093m0) · [unidades de cantidad](https://docs.aliaddo.com/unidades-de-cantidad-2171103m0) · [tributos](https://docs.aliaddo.com/tributos-impuestosretenciones-2171102m0)
- [Notas crédito y débito](https://docs.aliaddo.com/notas-cr%C3%A9dito-y-d%C3%A9bito-de-factura-electr%C3%B3nica-de-venta-2171119m0)
