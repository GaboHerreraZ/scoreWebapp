# Contrato Macro — Mapa de variables Zapsign

Cada variable `{{...}}` de la plantilla cargada en Zapsign se rellena vía API con el
array `data[]` que enviamos (`{ "de": "{{VARIABLE}}", "para": "valor" }`).

## EL CLIENTE (empresa que firma) — se rellena desde `Company`

| Variable en el contrato        | Fuente en la BD                                            | Notas |
|--------------------------------|------------------------------------------------------------|-------|
| `{{CLIENTE_RAZON_SOCIAL}}`     | `Company.name`                                             | |
| `{{CLIENTE_NIT}}`              | `Company.nit`                                              | |
| `{{CLIENTE_CIUDAD}}`           | `Company.daneCity.name`                                    | |
| `{{CLIENTE_DEPARTAMENTO}}`     | `Company.daneCity.region.name`                             | |
| `{{CLIENTE_DIRECCION}}`        | `Company.address`                                          | |
| `{{CLIENTE_REPRESENTANTE}}`    | `Company.legalRepName`                                     | representante legal |
| `{{CLIENTE_TIPO_DOC}}`         | `Parameter(Company.legalRepIdentificationTypeId).label`    | ej. "Cédula de ciudadanía" |
| `{{CLIENTE_NUM_DOC}}`          | `Company.legalRepIdentificationNumber`                     | |

El firmante (signer_email / signer_name) del CLIENTE = `Company.legalRepEmail` y
`Company.legalRepName`: quien tiene facultad para obligar a la sociedad, **no** el
usuario que se registró en la plataforma (pueden ser personas distintas). Estos
datos se piden en el onboarding (bloque `legalRep`) y se corrigen con
`PATCH /companies/:id`.

Si la empresa no los tiene (creada antes de que se pidieran), el envío falla con
400 en vez de caer al admin de la cuenta: hay que completarlos y reintentar con
`POST /companies/:companyId/contract/resend`.

## EL PROVEEDOR — valores FIJOS en código, no en variables de entorno

Viven en `src/documents/macro-contract/creditia.constants.ts` (`CREDITIA_PARTY`),
porque son constantes del negocio y no cambian entre staging y producción.

La versión vigente del contrato trae la razón social (RUSER CONSULTORES S.A.S.),
el NIT y el nombre del representante **escritos en el texto** de la plantilla, no
como variables. Por eso el contrato macro solo sustituye una:

| Variable en el contrato          | Constante             | Valor |
|----------------------------------|-----------------------|-------|
| `{{PROVEEDOR_CIUDAD}}`           | `CREDITIA_PARTY.city` | Bucaramanga |

`CREDITIA_PARTY.nit` sigue existiendo porque lo usan las **autorizaciones**
(`customer-authorizations`), cuyas plantillas sí lo piden como `{{PROVEEDOR_NIT}}`.

`CREDITIA_PARTY.signerName` no es una variable de plantilla: es el nombre con el
que se agrega a Creditia como firmante en Zapsign cuando la firma por API está
activa, así que debe coincidir con el usuario registrado en la organización.

## Firmas

La plantilla tiene 2 firmantes:

- **Cliente** → firma manual vía `sign_url` (Zapsign se lo envía por email).
- **Creditia (RUSER CONSULTORES S.A.S.)** → depende de la configuración:
  - Con `ZAPSIGN_CREDITIA_USER_TOKEN` configurado, se agrega como segundo firmante
    (`add-signer`, sin notificaciones) y se firma por API (`POST /sign/`, add-on
    "Batch signing"). El documento queda `signed` cuando firman los dos.
  - Sin esa variable, no es firmante electrónico: su firma va pre-impresa en la
    plantilla y el documento queda `signed` en cuanto firma el cliente.

Variables de entorno relacionadas:

| Env var | Para qué |
|---------|----------|
| `ZAPSIGN_MACRO_TEMPLATE_ID` | plantilla de Zapsign a usar |
| `ZAPSIGN_CREDITIA_USER_TOKEN` | `user_token` del representante legal (Zapsign → Mi perfil → "Firmar a través de API"). Vacío = firma pre-impresa |
| `ZAPSIGN_CREDITIA_SIGNER_EMAIL` | email del representante legal en Zapsign; debe coincidir con el del usuario que firma |
| `ZAPSIGN_CREDITIA_SIGNATURE_ANCHOR` | ancla `<<...>>` de la plantilla donde se estampa su firma. Vacío = página de firmas al final |
