# Contrato Macro — Mapa de variables Zapsign

Cada variable `{{...}}` de `contrato-macro-template.html` se rellena vía API con el
array `data[]` que enviamos a Zapsign (`{ "de": "{{VARIABLE}}", "para": "valor" }`).

## EL CLIENTE (empresa que firma) — se rellena desde `Company` / `Profile`

| Variable en el contrato        | Fuente en la BD                                   | Notas |
|--------------------------------|---------------------------------------------------|-------|
| `{{CLIENTE_RAZON_SOCIAL}}`     | `Company.name`                                    | |
| `{{CLIENTE_NIT}}`              | `Company.nit`                                     | |
| `{{CLIENTE_CIUDAD}}`           | `Company.city`                                    | |
| `{{CLIENTE_DEPARTAMENTO}}`     | `Company.state`                                   | |
| `{{CLIENTE_DIRECCION}}`        | `Company.address`                                 | |
| `{{CLIENTE_REPRESENTANTE}}`    | `Profile.name + ' ' + Profile.lastName`           | admin dueño (UserCompany rol administrator) |
| `{{CLIENTE_TIPO_DOC}}`         | `Parameter(Profile.identificationTypeId).value`   | ej. "Cédula de ciudadanía" |
| `{{CLIENTE_NUM_DOC}}`          | `Profile.identificationNumber`                    | |

El firmante (signer_email / signer_name) del CLIENTE = el email y nombre del
`Profile` administrador de la empresa (el mismo dueño que hizo el onboarding).

## EL PROVEEDOR (Creditia) — valores FIJOS desde variables de entorno

Estos NO cambian entre empresas. Se cargan una vez desde `.env` y se firman
automáticamente por Creditia (batch sign).

| Variable en el contrato          | Env var                          |
|----------------------------------|----------------------------------|
| `{{PROVEEDOR_RAZON_SOCIAL}}`     | `ZAPSIGN_CREDITIA_LEGAL_NAME`    |
| `{{PROVEEDOR_NIT}}`              | `ZAPSIGN_CREDITIA_NIT`           |
| `{{PROVEEDOR_CIUDAD}}`           | `ZAPSIGN_CREDITIA_CITY`          |
| `{{PROVEEDOR_REPRESENTANTE}}`    | `ZAPSIGN_CREDITIA_SIGNER_NAME`   |

Firmante (signer) de Creditia:
- `ZAPSIGN_CREDITIA_SIGNER_NAME`
- `ZAPSIGN_CREDITIA_SIGNER_EMAIL`

## Firmas (NO son variables)

En la plantilla de Zapsign se configuran 2 campos de firma:
- **Creditia** → firmado automáticamente por API al crear el documento.
- **Cliente** → firma manual vía sign_url (se le envía por email/WhatsApp).
