# Pagaré + autorización de espacios en blanco — Mapa de variables

Documento único que se firma cuando el estudio resulta **viable** o **viable con
condiciones** (nunca "no viable"). Quién firma depende del tipo de persona del
deudor: **PN** firma el propio consultado; **PJ** firma su **representante
legal** (columnas editables `legal_rep_*` del Customer — sin nombre, tipo,
número o correo del representante la emisión retorna 400). Reúne en un solo
acto de firma, estampado en ambas secciones:

1. **Pagaré No. N** — título valor (art. 621 y ss. C.Co.)
2. **Autorización para llenar espacios en blanco** (art. 622 C.Co.)

El **acreedor es la EMPRESA** cliente de Creditia (no Creditia). El consecutivo
`NOTE_NUMBER` es **único por empresa** (`promissory_notes.note_number`, unique
`(company_id, note_number)`); el `id` global sigue siendo el PK técnico.

La plantilla HTML vive en
`src/documents/promissory-notes/templates/pagare-template.html` (NO en docs/):
es fuente única tanto del modelo DOCX que se sube a Zapsign como del **preview**
en runtime (`POST .../promissory-notes/preview` la devuelve rellenada). El
backend rellena las variables al crear el documento (`createDocFromTemplate`),
igual que la autorización del titular.
Env: `ZAPSIGN_PROMISSORY_NOTE_TEMPLATE_ID`,
`ZAPSIGN_PROMISSORY_NOTE_SIGNATURE_ANCHOR`.

## Reglas de emisión (las valida `PromissoryNotesService.issue`)

- `CreditStudy.viabilityStatus` ∈ {`approved`, `conditional`}.
- **Monto editable** pero ≤ `CreditStudy.requestedCreditLine`.
- **Plazo en días editable** (`termDays`); vencimiento = fecha de emisión + plazo.
- Un solo pagaré activo (pendiente o firmado) por estudio.
- El estudio pasa a `credit_status = pendingSignature` al emitir; a `closed` al
  firmarse; vuelve a `studyCompleted` si se declina o el deudor rechaza.

## EL DEUDOR (el obligado del título valor)

| Variable               | Origen en la BD                                    | Notas |
|------------------------|-----------------------------------------------------|-------|
| `{{DEUDOR_NOMBRE}}`    | `Customer.businessName`                             | nombre completo (PN) o razón social (PJ) |
| `{{DEUDOR_TIPO_DOC}}`  | label del Parameter `identification_type`           | CC, NIT, CE… |
| `{{DEUDOR_NUM_DOC}}`   | `Customer.identificationNumber` (+ `-DV` en PJ)     | PJ: NIT con dígito de verificación (`900123456-7`) |
| `{{DEUDOR_DIRECCION}}` | `Customer.address`                                  | `—` si no hay |
| `{{DEUDOR_TELEFONO}}`  | `Customer.phone`                                    | `—` si no hay |
| `{{DEUDOR_EMAIL}}`     | correo del **firmante**                             | PN: `Customer.email`; PJ: `Customer.legalRepEmail` — **requerido** |

## EL FIRMANTE (quien suscribe: el deudor en PN, su representante legal en PJ)

| Variable                  | PN                                        | PJ |
|---------------------------|-------------------------------------------|----|
| `{{FIRMANTE_NOMBRE}}`     | `Customer.businessName`                   | `Customer.legalRepName` — **requerido** |
| `{{FIRMANTE_TIPO_DOC}}`   | label del `identification_type` del deudor| label del `legalRepIdentificationType` — **requerido** |
| `{{FIRMANTE_NUM_DOC}}`    | `Customer.identificationNumber`           | `Customer.legalRepIdentificationNumber` — **requerido** |
| `{{FIRMANTE_ACTUACION}}`  | fijo: `actuando en nombre propio`         | `actuando en calidad de representante legal de <razón social>, identificada con NIT <nit-dv>` |
| `{{FIRMANTE_LINEA_REP}}`  | vacío                                     | `Representante legal: <nombre> · <tipo doc> No. <número>` (disponible; hoy la plantilla no la usa) |

## EL ACREEDOR (la empresa cliente de Creditia)

Snapshot congelado en `promissory_notes` al emitir (si la empresa edita sus
datos después, el pagaré emitido no cambia).

| Variable                    | Origen en la BD                              | Snapshot en tabla |
|-----------------------------|----------------------------------------------|-------------------|
| `{{ACREEDOR_RAZON_SOCIAL}}` | `Company.name`                               | — |
| `{{ACREEDOR_NIT}}`          | `Company.nit`                                | — |
| `{{ACREEDOR_DIRECCION}}`    | `Company.address`                            | `creditor_address` |
| `{{ACREEDOR_CIUDAD}}`       | `Company.city`                               | `sign_city` |
| `{{ACREEDOR_TIPO_CUENTA}}`  | label del Parameter `Company.accountType`    | `creditor_account_type` — **requerido** |
| `{{ACREEDOR_NUM_CUENTA}}`   | `Company.accountNumber`                      | `creditor_account_number` — **requerido** |
| `{{ACREEDOR_BANCO}}`        | label del Parameter `Company.accountBank`    | `creditor_bank` — **requerido** |

## LA OBLIGACIÓN (snapshot editable al emitir)

Es un **pagaré en blanco**: el documento **no imprime el monto ni la fecha de
pago** (van en línea de guiones, los llena el acreedor conforme a la Sección 2, art.
622 C.Co.). `amount`, `amount_in_words`, `term_days` y `due_date` se siguen
guardando en `promissory_notes` (referencia interna, recordatorio de pago y
tope vs. el cupo del estudio), pero **ya no se envían a la plantilla**: las
variables `{{MONTO_LETRAS}}`, `{{MONTO_NUMERO}}`, `{{PAGO_DIA}}`,
`{{PAGO_MES}}` y `{{PAGO_ANIO}}` fueron eliminadas del mapeo.

| Variable            | Origen                                                | Notas |
|---------------------|--------------------------------------------------------|-------|
| `{{NOTE_NUMBER}}`   | `promissory_notes.note_number`                         | consecutivo por empresa; aparece 4 veces en el texto |
| `{{FORMA_PAGO}}`    | fijo: `un solo pago`                                   | |
| `{{FIRMA_CIUDAD}}`  | `Company.city`                                         | = `sign_city` |
| `{{FIRMA_DIA/MES/ANIO}}` | fecha de emisión (TZ Bogotá)                      | mes en letras |

## PLATAFORMA

| Variable       | Origen        |
|----------------|---------------|
| `{{LOGO_URL}}` | env `LOGO_URL`|

## Firma

Un solo firmante (`{{DEUDOR_EMAIL}}`): el deudor en PN, o el **representante
legal** de la sociedad deudora en PJ (Zapsign recibe su nombre y su correo). La
firma electrónica cubre las dos secciones (pagaré + autorización de espacios en
blanco). El acreedor no firma: emite el documento.

### Posicionamiento (firma visible en las dos páginas)

`issue()` envía `signature_placement` a `/models/create-doc/` con el valor de
`ZAPSIGN_PROMISSORY_NOTE_SIGNATURE_ANCHOR` (recomendado: `<<FIRMA_DEUDOR>>`).
El ancla aparece **dos veces** en la plantilla —encima de la línea de firma de
cada sección— y **Zapsign estampa la firma en todas las ocurrencias**, así que
sale en el pagaré y en la autorización.

Sigue siendo **un solo acto de firma**: un `doc_signed`, un certificado de
finalización y un hash que cubren el PDF completo (Ley 527/1999, Decreto
2364/2012). Lo que cambia es dónde se ve la firma, no cuántas hay.

Detalles operativos:

- Zapsign **no borra** el texto del ancla: va en color blanco (`.sign-anchor`)
  para que no se vea ni en el PDF ni en el preview.
- El ancla usa `<<...>>`; las variables de plantilla usan `{{...}}`. No chocan.
- Al armar el DOCX, escribir `<<FIRMA_DEUDOR>>` de un tirón: si Word lo parte en
  *runs* distintos (autocorrección, formato mixto), Zapsign no lo encuentra.
- Sin la env configurada, el comportamiento es el histórico: Zapsign coloca la
  firma solo al final del documento.

## Ciclo de vida y webhook

Los eventos llegan al despachador único (`/webhooks/zapsign/*`) y se enrutan por
`provider_doc_token`:

- `doc_signed` → verifica estado real en Zapsign, respalda el PDF en el bucket
  privado `promissory-notes` (`SUPABASE_STORAGE_BUCKET_PROMISSORY_NOTES`),
  marca `signed` y cierra el estudio (`closed`).
- `doc_refused` → marca `declined` con `refused_reason` y devuelve el estudio a
  `studyCompleted` (se puede reemitir; el nuevo pagaré toma otro consecutivo).
