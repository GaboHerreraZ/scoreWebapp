# Facturación electrónica — integración

Estado: **implementada contra la API contable de Aliaddo**, pendiente de probar
en la cuenta de pruebas.
Objetivo de diseño: que cambiar de proveedor mañana (Alegra, Factus, Siigo,
Dataico…) toque **una sola carpeta**.

---

## 1. De dónde partimos (lo que YA existía)

| Pieza                      | Dónde                                                                       | Qué hace                                                                                      |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Desglose fiscal congelado  | `AnalysisPack.taxRatePaid / taxBase / taxAmount / totalPaid / currencyCode` | Se congela al cobrar. Invariante: `totalPaid = taxBase + taxAmount`                           |
| Datos fiscales del cliente | `Company.billing*`                                                          | Razón social, docType, docNumber, email, dirección, ciudad DANE, régimen, responsabilidades   |
| Cola de facturación        | `admin.service.ts` → `GET/PATCH/DELETE /admin/einvoices`                    | Lista ventas pagadas sin facturar; la marca manual sigue existiendo como salida de emergencia |
| Marca de emitida           | `AnalysisPack.einvoiceSent / einvoiceSentAt / einvoiceNumber`               | Denormalizado que alimenta la cola                                                            |
| Catálogo DANE              | `dane_regions` + `dane_cities`, módulo `src/locations/`                     | 33 departamentos + 1.123 municipios, sembrados del catálogo del facturador                    |

---

## 2. Aliaddo expone DOS APIs — vamos con la contable

|                 | **A · Integradores Nitro**                                                      | **B · Software contable y administrativo** ✅                                |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Endpoint        | `POST /v2/documents/invoices`                                                   | `POST /invoices`                                                             |
| Payload         | Documento fiscal COMPLETO: `resolution`, `customer`, `lines`, `taxes`, `totals` | **Referencias a maestros**: `personId`, `branchId`, `itemCode`, `taxes[].id` |
| Resolución DIAN | La enviamos nosotros (clave técnica, prefijo, rangos)                           | La configura Aliaddo en la cuenta                                            |
| Consecutivo     | Lo llevamos nosotros                                                            | Lo asigna Aliaddo (devuelve `consecutive`)                                   |
| Totales         | Los enviamos                                                                    | **Los calcula Aliaddo**                                                      |
| Maestros        | No existen                                                                      | Hay que **crearlos y sincronizarlos** antes de facturar                      |
| Ambiente        | `mode` en el payload                                                            | Propiedad de la CUENTA, no del payload                                       |
| Anular          | —                                                                               | `PATCH /invoices/{id}/void`                                                  |

**Por qué B:** nos saca de encima toda la superficie DIAN riesgosa — resolución,
clave técnica, rangos, consecutivos atómicos, contingencia y habilitación las
lleva Aliaddo. Con A, un bug de concurrencia en el consecutivo son facturas
duplicadas ante la DIAN, y eso solo se corrige con notas crédito.

**Lo que cuesta:** hay que mantener terceros y productos sincronizados, y los
importes ya no los controlamos (§7).

A volvería a tener sentido si Creditia quisiera emitir facturas **de sus
clientes** a nombre de ellos. Hoy `InvoiceDocument` no lleva emisor: siempre
factura Creditia (RUSER CONSULTORES S.A.S.).

### Endpoints usados

| Qué                   | Método y ruta                                           |
| --------------------- | ------------------------------------------------------- | ------------------ | ------------------- |
| Emitir                | `POST /invoices`                                        |
| Consultar             | `GET /invoices/{id}`                                    |
| Anular                | `PATCH /invoices/{id}/void?accountCode=`                |
| Buscar terceros       | `GET /people?identification=&email=&phoneNumber=&kind=` |
| Crear tercero         | `POST /people`                                          |
| Productos             | `GET                                                    | POST /items`, `PUT | DELETE /items/{id}` |
| Impuestos             | `GET /taxes`                                            |
| Sucursales            | `GET /branches`                                         |
| Categorías / unidades | `GET /item-categories`, `GET /measuring-units`          |
| Cuentas contables     | `GET /chart-accounts`                                   |

---

## 3. Arquitectura — 3 capas, igual que `credit-bureau`

```
src/e-invoicing/
├── e-invoicing.module.ts         # { provide: E_INVOICE_PROVIDER, useClass: AliaddoProvider }
├── e-invoicing.controller.ts     # panel admin: /admin/einvoices/*
├── e-invoicing.service.ts        # contactos, emisión, reconsulta, anulación
├── einvoice-items.service.ts     # catálogo de ítems facturables
├── e-invoicing.repository.ts     # Prisma
├── fiscal-profile.validator.ts
├── domain/
│   ├── invoice-document.ts       # tipos NEUTROS del documento
│   ├── billing-catalog.ts        # tipos NEUTROS de los maestros del facturador
│   ├── dian.catalogs.ts          # códigos DIAN (nacionales, NO del proveedor)
│   ├── payment-means.ts          # franquicia de la pasarela → medio de pago DIAN
│   └── verification-digit.ts     # DV del NIT (algoritmo DIAN)
├── providers/
│   ├── e-invoice-provider.interface.ts   # el PUERTO
│   ├── e-invoice-result.ts
│   └── aliaddo.provider.ts       # implementa el puerto; orquesta client + mapper
├── aliaddo/
│   ├── aliaddo.client.ts         # HTTP puro: verbos, token, timeouts, 429
│   ├── aliaddo.mapper.ts         # dominio ⇄ payloads de Aliaddo
│   ├── aliaddo.catalogs.ts       # solo lo que Aliaddo se inventó
│   └── aliaddo.types.ts          # tipos crudos
└── dto/
```

### Regla de oro

**Ningún tipo de `aliaddo/` cruza fuera de esa carpeta**, y ninguna tabla,
columna, DTO ni ruta nombra al proveedor. Los services solo conocen
`InvoiceDocument`, `BillingContact`, `ProviderItem` y `EInvoiceResult`.

Matiz: **los códigos DIAN no son del proveedor.** Tipos de identificación,
responsabilidades, régimen, medios de pago, DANE y unidades de medida son
estándar nacional — van en `domain/dian.catalogs.ts`.

### El puerto

Tiene tres bloques porque la API contable exige los tres. En un proveedor que
reciba el documento completo, los dos últimos se implementan como no-ops.

```ts
interface IEInvoiceProvider {
  readonly name: string;
  readonly environment: InvoiceEnvironment;

  // Documentos
  issueInvoice(doc: InvoiceDocument): Promise<EInvoiceResult>;
  getInvoice(externalId: string): Promise<EInvoiceResult>;
  voidInvoice(externalId, opts?): Promise<EInvoiceResult>;

  // Terceros
  findContacts(query: ContactQuery): Promise<BillingContact[]>;
  createContact(party: InvoiceParty): Promise<BillingContact>;
  supportsIdentificationType(dianCode: string): boolean;

  // Catálogo de productos
  listItems(query?) / createItem / updateItem / deleteItem

  // Catálogos de apoyo
  listTaxes / listItemCategories / listMeasuringUnits / listBranches
  listPaymentAccounts / resolveDefaultBranchRef
}
```

Como en DataCrédito, **se archiva siempre el `raw`** de la respuesta: es la
evidencia ante la DIAN y ante el cliente.

---

## 4. Modelo de datos

### `einvoice_items` — catálogo de ítems facturables

**Nuestra** fuente de verdad de qué se factura. El facturador guarda una copia
enlazada por `provider_item_id`. Cambiar de facturador conserva el catálogo.

Campos propios: `code` (único), `name`, `description`, `unit_measurement_code`,
`price_sell`, `tax_rate`, `is_active`.
Enlace: `provider`, `provider_item_id`, `provider_item_code`, `provider_tax_ids`
(jsonb con los impuestos que confirmó el facturador), `provider_category_ref`,
`provider_measuring_unit_ref`, `provider_synced_at`.

`PackOffering.einvoice_item_id` dice con qué ítem se factura cada oferta. **Sin
ítem asociado la venta no se puede facturar** — sale como bloqueador del preview,
no como error al emitir.

### `einvoice_contact_refs` — empresa ↔ tercero del facturador

Único por `(provider, company_id)`. Guarda `identification`: si la empresa cambia
de documento el vínculo deja de valer y hay que rehacerlo. `linked_by` deja
constancia de quién lo vinculó.

### `electronic_invoices` — el documento

Se conservó completa. Cambios:

- Nuevas: `provider_contact_id`, `provider_branch_id`, `provider_status` (jsonb
  con `status`/`statusDian`/`stateDian` crudos), `voided_at`, `voided_by`,
  `void_reason`.
- **LEGADO** y ya sin escribirse: `resolution_id`, `prefix`, `consecutive`.
  `number` guarda el consecutivo completo que devuelve Aliaddo (`SETP992001914`).
- El único parcial pasó de `WHERE analysis_pack_id IS NOT NULL` a
  `WHERE analysis_pack_id IS NOT NULL AND voided_at IS NULL`. Con la anulación el
  índice viejo obligaba a reusar la fila anulada al reemitir, borrando su CUFE y
  su motivo — justo la evidencia que la DIAN puede pedir después. Ahora: **una
  factura viva por venta, y todas las anuladas que haga falta.**

### `einvoice_resolutions` — LEGADO

No se borra: un documento emitido tiene que poder mostrar bajo qué autorización
se expidió. Nada la escribe ya, y sus endpoints admin se retiraron.

---

## 5. Flujo del botón

La emisión es **manual**: el webhook de pago solo avisa que hay algo que
facturar.

```
GET /admin/einvoices/:packId/preview
  ├─ perfil fiscal de la empresa                → blockers
  ├─ ítem:  packOffering.einvoiceItem           → blockers si falta o no está sincronizado
  │            + contrasta tax_rate contra el IVA congelado en la venta
  ├─ sucursal: la configurada o la isDefault    → blockers si no hay
  └─ contacto:
        ¿einvoice_contact_refs con el MISMO documento?
           sí → 'linked'  ✅ se puede emitir
           no → GET /people?identification=<NIT> (Company y Person)
                 1+ → 'found'        el financiero elige cuál
                 0  → 'not_found'    "¿deseas crearlo?"
                 tipo de doc no admitido → 'unsupported'
                 el facturador no responde → 'unavailable'

POST /admin/einvoices/:packId/contact/link  { contactRef }   ← eligió uno
POST /admin/einvoices/:packId/contact                        ← dijo que sí, créalo

POST /admin/einvoices/:packId/issue
      → POST /invoices  (personId, branchId, itemCode, taxes[].id)
      → contrasta el totalAmount devuelto contra lo cobrado
      → accepted: guarda CUFE/QR/PDF y marca AnalysisPack.einvoiceSent
```

**Búsqueda por documento, no por nombre.** `GET /people` solo filtra por
`identification`, `email` y `phoneNumber` — los tres "contiene" — más `kind`, que
**por defecto es `Person`**: para hallar empresas hay que preguntar por los dos y
unir. El documento es además la llave que va impresa en la factura, así que es la
correcta.

**Vincular se confirma contra el facturador**, no se le cree al front: un `ref`
inventado facturaría a otra empresa.

---

## 6. Panel admin

Todo bajo `/admin/einvoices`, en `e-invoicing.controller.ts`. En
`admin.controller.ts` se quedan solo la **cola** (`GET /admin/einvoices`) y la
marca manual (`PATCH`/`DELETE`), que son consultas sobre `analysis_packs`.

| Ruta                                                                 | Qué                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET config`                                                         | proveedor, ambiente declarado, kill switch, cuenta de recaudo |
| `GET taxes \| categories \| measuring-units \| branches \| accounts` | catálogos del facturador para los formularios                 |
| `GET\|POST items`, `PUT\|DELETE items/:id`, `POST items/:id/sync`    | catálogo de ítems facturables                                 |
| `PATCH offerings/:id/item`                                           | con qué ítem se factura una oferta                            |
| `GET contacts`                                                       | buscador libre en el directorio                               |
| `GET\|POST :packId/contact`, `POST :packId/contact/link`             | el cliente de una venta                                       |
| `GET :packId/preview` · `POST :packId/issue`                         | emitir                                                        |
| `GET :packId/documents`                                              | histórico, anuladas incluidas                                 |
| `POST documents/:id/refresh` · `POST documents/:id/void`             | ciclo de vida                                                 |

El front (`webApp`) **no tiene todavía ninguna pantalla de facturación**: estos
endpoints son su contrato.

---

## 7. Los importes ya no los controlamos

Con esta API se envía `unitValueBeforeTax`, `quantity` y el **id** del impuesto;
el total lo calcula Aliaddo. Si el impuesto configurado allá no es el que se
congeló al cobrar, **la factura sale por otro valor**.

Tres defensas, en orden:

1. `einvoice_items.tax_rate` se contrasta con `AnalysisPack.taxRatePaid` en el
   preview → bloqueador antes de emitir.
2. Si la venta lleva IVA y el ítem no tiene impuesto sincronizado → bloqueador.
3. Después de emitir se compara `totalAmount` contra `totalPaid` (tolerancia 1
   peso). Si no casan: queda en `status_reasons` y `last_error`, se loguea como
   error y se reporta a Sentry. **No se revierte** — el documento ya está ante la
   DIAN y corregirlo es una nota crédito.

---

## 8. Quién es el adquirente

El comprador siempre es una `Company`, pero la identidad fiscal sale de
`Company.billing*`, que distingue los dos casos desde el onboarding:

|                     | Persona jurídica                  | Persona natural                   |
| ------------------- | --------------------------------- | --------------------------------- |
| Nombre              | `billingBusinessName`             | `billingName` + `billingLastName` |
| Documento           | `nit`                             | `cc`, `ce`, `pas`…                |
| `personType` DIAN   | `1`                               | `2`                               |
| `regimeType` típico | `48` responsable de IVA           | `49` no responsable               |
| `responsibilities`  | `O-13` / `O-15` / `O-23` / `O-47` | `R-99-PN`                         |
| `digitCheck`        | calculado sobre el NIT            | vacío                             |

Mapa `Parameter 'identification_type'.code → código DIAN` en
`domain/dian.catalogs.ts`: `cc→13`, `nit→31`, `ce→22`, `pas→41`, `ti→12`,
`ppt→48`, `pep→47`, `dni→42`, `pje→50`.

> ⚠️ **Aliaddo acepta un subconjunto**: `13, 21, 22, 31, 41, 42, 47, 50, 91`.
> **`ti` (12) y `ppt` (48) no se pueden dar de alta como tercero.** El preview lo
> detecta antes (`contact.status = 'unsupported'`) en vez de fallar al pulsar
> "crear", cuando la venta ya está cobrada.

### El catálogo de ciudades

`DaneCity` guarda dos nombres: `dianName` (el exacto del catálogo, `'Bogotá,
D.c.'`) y `name` (normalizado para los desplegables). Al crear el tercero la
dirección viaja con **códigos** DANE (`region` = 2 dígitos, `city` = 5), que es lo
que Aliaddo exige para Colombia.

Fuente del seed: el catálogo del proveedor, **no DIVIPOLA del DANE**. Difieren en
3 municipios y quien rechaza el documento es la DIAN.

---

## 9. Variables de entorno

```
# Dominio — no cambian si mañana el proveedor es otro
EINVOICE_PROVIDER=aliaddo
EINVOICE_ENABLED=false             # kill switch: en false registra, no envía
EINVOICE_ENVIRONMENT=test          # test | habilitation | production
EINVOICE_PAYMENT_ACCOUNT_CODE=     # cuenta de bancos/caja del recaudo

# Adaptador Aliaddo
ALIADDO_API_URL=https://nitro.aliaddo.net
ALIADDO_TOKEN=...                  # portal Nitro → Integración → generar token
ALIADDO_BRANCH_ID=                 # opcional; si falta se usa la isDefault
```

### `EINVOICE_ENVIRONMENT` es solo una etiqueta

Con esta API el ambiente **no viaja en el payload**: lo determina la CUENTA de
Aliaddo a la que pertenece el token. Un token de producción factura en producción
diga lo que diga esta variable. Sirve para archivarlo con el documento y para las
advertencias del panel — **no protege de nada**. Sigue sin default: un valor
desconocido revienta al arrancar.

### `EINVOICE_PAYMENT_ACCOUNT_CODE`

Sin ella la factura nace como **cuenta por cobrar abierta**, aunque el cliente ya
haya pagado — y la contabilidad de Aliaddo acumula cartera falsa. Con ella nace
`Pagada`. Se consulta el código en `GET /admin/einvoices/accounts`. También es lo
que la anulación manda como `accountCode`, obligatorio al anular una factura
pagada.

---

## 10. Puesta en marcha

1. **En el portal de Aliaddo:** confirmar la resolución DIAN de la cuenta y que
   el token es de la cuenta correcta (pruebas vs producción).
2. `GET /admin/einvoices/branches` → confirmar que hay una sucursal habilitada.
3. `GET /admin/einvoices/accounts` → tomar el código de la cuenta de bancos y
   ponerlo en `EINVOICE_PAYMENT_ACCOUNT_CODE`.
4. `GET /admin/einvoices/taxes`, `/categories`, `/measuring-units` → tomar los
   refs para el formulario del ítem.
5. `POST /admin/einvoices/items` con `PACK-CONSULTAS`, `taxRate: 19` y los refs
   del paso anterior.
6. `PATCH /admin/einvoices/offerings/:id/item` para cada oferta del catálogo.
7. `EINVOICE_ENABLED=true` y emitir una venta de prueba.

---

## 11. Riesgos

| Riesgo                                    | Mitigación                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| El facturador calcula los importes        | §7: dos bloqueadores antes y una verificación después                                     |
| Datos fiscales incompletos → rechazo DIAN | Se validan **antes de cobrar**, no antes de facturar                                      |
| Doble emisión por doble clic              | Único parcial sobre `analysis_pack_id` (no anuladas) + idempotencia por estado `accepted` |
| Reemitir tras anular borraría la anulada  | El índice excluye `voided_at IS NOT NULL`                                                 |
| Tercero existente sin `isCustomer`        | El preview lo advierte: no se le puede facturar sin corregirlo en el portal               |
| Ambiente no verificable desde el código   | §9: warning permanente en el preview fuera de producción                                  |
| Rate limit (429)                          | Un reintento leyendo `X-Rate-Limit-Reset`; 50–150 req/min según el plan                   |
| Cambio de proveedor                       | Se reescribe `aliaddo/` + una línea del módulo. Dominio, tablas y pantallas se quedan     |

### Pendiente de confirmar contra la cuenta de pruebas

- El esquema real de `GET /chart-accounts`: la documentación no publica sus
  campos y de ahí sale el código de la cuenta de recaudo.
- Si `void` sobre una factura ya validada por la DIAN genera nota crédito o solo
  la marca `Invalida`.
- Si `POST /invoices` acepta `details[].taxes` ausente cuando la venta no lleva
  IVA.

---

## Referencias

- [Autenticación (API contable)](https://docs.aliaddo.com/autenticaci%C3%B3n-2248457m0) · [Límite de request](https://docs.aliaddo.com/l%C3%ADmite-de-request-2248565m0)
- [Crear factura de venta](https://docs.aliaddo.com/crear-factura-de-venta-36444000e0) · [Consultar una factura](https://docs.aliaddo.com/consultar-una-factura-36444024e0) · [Anular una factura](https://docs.aliaddo.com/anular-una-factura-36444046e0)
- [Consultar contactos](https://docs.aliaddo.com/consultar-los-contactos-36443988e0) · [Crear contacto](https://docs.aliaddo.com/crear-contacto-36443989e0)
- [Productos](https://docs.aliaddo.com/consultar-los-productos-36443999e0) · [Crear producto](https://docs.aliaddo.com/crear-un-producto-36443998e0) · [Impuestos](https://docs.aliaddo.com/consultar-los-impuestos-36443984e0)
- [Sucursales](https://docs.aliaddo.com/consultar-sucursales-36443993e0) · [Categorías](https://docs.aliaddo.com/consultar-categor%C3%ADas-36444009e0) · [Unidades de medida](https://docs.aliaddo.com/consultar-unidades-de-medidas-36444010e0) · [Cuentas contables](https://docs.aliaddo.com/consultar-cuentas-contables-36444039e0)
- Catálogos DIAN: [tipos de identificación](https://docs.aliaddo.com/tipos-de-identificacion-2171097m0) · [tipos de régimen](https://docs.aliaddo.com/tipos-de-regimen-2171101m0) · [responsabilidades fiscales](https://docs.aliaddo.com/responsabilidades-fiscales-2171096m0) · [medios de pago](https://docs.aliaddo.com/medios-de-pagos-2171094m0) · [unidades de cantidad](https://docs.aliaddo.com/unidades-de-cantidad-2171103m0)
