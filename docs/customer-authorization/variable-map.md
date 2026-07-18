# Autorización del titular consultado (documento único) — Mapa de variables

Documento que firma el **titular consultado** (persona/empresa cuya información
se consultará en centrales de riesgo) antes de que la EMPRESA cliente pueda
consultarlo. Fusiona en un solo acto y una sola firma tres autorizaciones:
tratamiento de datos (Ley 1581), Habeas Data (Ley 1266) y custodia.

> NO incluye la **divulgación a terceros** (finalidad facultativa): esa va en un
> documento aparte con su propia firma, para no condicionar el servicio a una
> finalidad no necesaria (criterio SIC). Se implementa después.

Se sube a Zapsign como plantilla DOCX; el backend rellena las variables al crear
el documento (`createDocFromTemplate`), igual que el contrato macro.

## EL TITULAR (quien firma — persona/empresa consultada)

Se captura al **solicitar la autorización**, antes de que exista el `Customer`
(el Customer nace de la consulta al bureau, que requiere esta firma). Se guarda
como snapshot en `CustomerAuthorization`.

| Variable                        | Origen                                                    | Notas |
|---------------------------------|-----------------------------------------------------------|-------|
| `{{TITULAR_NOMBRE}}`            | `CustomerAuthorization.titularName` (= `apellidoRazonSocial` del from-bureau) | nombre/razón social |
| `{{TITULAR_TIPO_DOC}}`          | label del Parameter `identification_type` (por `identificationTypeId`) | CC, NIT, CE… |
| `{{TITULAR_NUM_DOC}}`           | `CustomerAuthorization.identificationNumber`              | |
| `{{TITULAR_EMAIL}}`             | `CustomerAuthorization.titularEmail`                      | **= firmante en Zapsign** |

> Simplificado: no se recogen ciudad ni representación del titular. El nombre del
> documento sale de la razón social/apellido validado en el bureau.

## LA EMPRESA (cliente de Creditia que solicita la consulta)

| Variable                     | Origen en la BD  |
|------------------------------|------------------|
| `{{EMPRESA_RAZON_SOCIAL}}`   | `Company.name`   |
| `{{EMPRESA_NIT}}`            | `Company.nit`    |

## CREDITIA (operador tecnológico) — valores fijos

| Variable                | Origen               |
|-------------------------|----------------------|
| `{{PROVEEDOR_NIT}}`     | `CREDITIA_PARTY.nit` |
| `{{PROVEEDOR_CIUDAD}}`  | `CREDITIA_PARTY.city`|
| `{{LOGO_URL}}`          | env `LOGO_URL`       |

## Firma

Un solo firmante: **el titular** (`{{TITULAR_EMAIL}}`). La firma electrónica al
final cubre las tres partes. Creditia no firma (su aceptación va implícita al
emitir el documento).

## Marco legal citado

- **Ley 1581 de 2012** + **Decreto 1377 de 2013** — tratamiento de datos personales.
- **Ley 1266 de 2008** — Habeas Data financiero (centrales de riesgo).
- **Ley 527 de 1999** / **Decreto 2364 de 2012** — validez de la firma electrónica.

## Origen de la fusión

Se armó a partir de (articulado conservado textual):
- `docs/data-authorization/autorizacion-datos-template.html` → Parte Primera
- `docs/habeas-data/autorizacion-habeas-data-template.html` → Parte Segunda
- `docs/custody-authorization/autorizacion-custodia-template.html` → Parte Tercera
