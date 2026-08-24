# Autorización del titular consultado (documento único) — Mapa de variables

Documento que firma el **titular consultado** (persona/empresa cuya información
se consultará en centrales de riesgo) antes de que la EMPRESA cliente pueda
consultarlo. Fusiona en un solo acto y una sola firma tres autorizaciones:
tratamiento de datos (Ley 1581), Habeas Data (Ley 1266) y custodia.

> NO incluye la **divulgación a terceros** (finalidad facultativa): esa va en un
> documento aparte con su propia firma, para no condicionar el servicio a una
> finalidad no necesaria (criterio SIC). Se implementa después.

Se sube a Zapsign como plantilla DOCX; el backend rellena las variables al crear
el documento (`createDocFromTemplate`), igual que el pagaré.

## Plantillas separadas por tipo de persona

| Env | Plantilla | Cuándo se usa |
|-----|-----------|---------------|
| `ZAPSIGN_CUSTOMER_AUTH_TEMPLATE_ID_PN` | Persona natural | `identificationTypeCode` ≠ `nit` (cc, ce, pas, pa) |
| `ZAPSIGN_CUSTOMER_AUTH_TEMPLATE_ID_PJ` | Persona jurídica | `identificationTypeCode` = `nit` |

Ambas son obligatorias (sin la que corresponda → 400). El antiguo
`ZAPSIGN_CUSTOMER_AUTH_TEMPLATE_ID` (plantilla única) fue eliminado.

## EL TITULAR (quien firma)

Se captura al **solicitar la autorización**, antes de que exista el `Customer`
(el Customer nace de la consulta al bureau, que requiere esta firma). Se guarda
como snapshot en `CustomerAuthorization` (nombre/email; los datos del
representante legal quedan en el PDF firmado y en `Customer.legalRep*`).

### Persona natural — firma el propio titular

| Variable                        | Origen                                                    | Notas |
|---------------------------------|-----------------------------------------------------------|-------|
| `{{TITULAR_NOMBRE}}`            | `titularName` (= `apellidoRazonSocial` del from-bureau)   | |
| `{{TITULAR_TIPO_DOC}}`          | label del Parameter `identification_type`                 | CC, CE… |
| `{{TITULAR_NUM_DOC}}`           | `identificationNumber`                                    | |
| `{{TITULAR_EN_REPRESENTACION}}` | siempre `''`                                              | PN actúa "en nombre propio" |
| `{{TITULAR_CIUDAD}}`            | `titularCity` del from-bureau, o `Customer.city` si la identidad ya fue consultada | `''` si no hay ninguno |
| `{{TITULAR_EMAIL}}`             | `titularEmail`                                            | **= firmante en Zapsign** |

### Persona jurídica — firma su representante legal

| Variable                    | Origen                                                     | Notas |
|-----------------------------|------------------------------------------------------------|-------|
| `{{TITULAR_NOMBRE}}`        | `legalRepName` (body) o `Customer.legalRepName`            | representante legal |
| `{{TITULAR_TIPO_DOC}}`      | label del tipo de doc del rep. legal (body o Customer)     | CC, CE… |
| `{{TITULAR_NUM_DOC}}`       | `legalRepIdentificationNumber` (body o Customer)           | |
| `{{TITULAR_RAZON_SOCIAL}}`  | `titularName` (= razón social validada)                    | sociedad consultada |
| `{{TITULAR_NIT}}`           | `identificationNumber`                                     | NIT de la sociedad consultada |
| `{{TITULAR_CIUDAD}}`        | `titularCity` del from-bureau, o `Customer.city` si la identidad ya fue consultada | `''` si no hay ninguno |
| `{{TITULAR_EMAIL}}`         | `titularEmail` (= correo del rep. legal)                   | **= firmante en Zapsign** |

Los datos del representante legal vienen en el body del from-bureau
(`legalRepName`, `legalRepIdentificationTypeCode`,
`legalRepIdentificationNumber`); lo no enviado cae al `Customer` existente (si
la identidad ya fue consultada, el bureau siembra `Customer.legalRep*`). Si aun
así faltan → 400.

> ⚠️ **La plantilla DOCX de PJ debe usar `{{TITULAR_RAZON_SOCIAL}}` /
> `{{TITULAR_NIT}}` en la frase "representante legal de …, NIT …"**. El
> borrador del documento traía ahí `{{EMPRESA_RAZON_SOCIAL}}` /
> `{{EMPRESA_NIT}}`, pero esas variables son la EMPRESA Responsable (cliente de
> Creditia) y Zapsign reemplaza TODAS las apariciones con el mismo valor: la
> sociedad consultada saldría con los datos de la empresa que consulta.

## LA EMPRESA (cliente de Creditia que solicita la consulta)

| Variable                     | Origen en la BD  |
|------------------------------|------------------|
| `{{EMPRESA_RAZON_SOCIAL}}`   | `Company.name`   |
| `{{EMPRESA_NIT}}`            | `Company.nit`    |

## CREDITIA (operador tecnológico) — valores fijos

| Variable                | Origen               | Notas |
|-------------------------|----------------------|-------|
| `{{PROVEEDOR_NIT}}`     | `CREDITIA_PARTY.nit` | los textos nuevos traen el NIT de Ruser en duro; se sigue enviando por si el encabezado lo usa |
| `{{PROVEEDOR_CIUDAD}}`  | `CREDITIA_PARTY.city`| ídem |
| `{{LOGO_URL}}`          | env `LOGO_URL`       | |

## Firma

Un solo firmante: el **titular** (PN) o su **representante legal** (PJ), al
correo `{{TITULAR_EMAIL}}`. La firma electrónica al final cubre las tres
partes. Creditia no firma (su aceptación va implícita al emitir el documento).

## Marco legal citado

- **Ley 1581 de 2012** + **Decreto 1377 de 2013** — tratamiento de datos personales.
- **Ley 1266 de 2008** — Habeas Data financiero (centrales de riesgo).
- **Ley 527 de 1999** / **Decreto 2364 de 2012** — validez de la firma electrónica.

## Origen de la fusión

Se armó a partir de (articulado conservado textual):
- `docs/data-authorization/autorizacion-datos-template.html` → Parte Primera
- `docs/habeas-data/autorizacion-habeas-data-template.html` → Parte Segunda
- `docs/custody-authorization/autorizacion-custodia-template.html` → Parte Tercera
