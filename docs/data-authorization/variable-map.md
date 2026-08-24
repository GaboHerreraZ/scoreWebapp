# Autorización de tratamiento de datos — Mapa de variables

Documento que firma el **titular consultado** (persona/empresa cuyos datos se
consultan en centrales de riesgo) autorizando a la EMPRESA cliente y a CREDITIA
el tratamiento de datos y la consulta/reporte en centrales de riesgo.

> Por ahora es SOLO el documento. Estas variables quedan documentadas por si más
> adelante se genera vía Zapsign (como la autorización del titular).

## EL TITULAR (quien firma — persona consultada)

| Variable                        | Fuente sugerida                       | Notas |
|---------------------------------|---------------------------------------|-------|
| `{{TITULAR_NOMBRE}}`            | nombre completo del consultado        | |
| `{{TITULAR_TIPO_DOC}}`         | tipo de documento (CC, NIT, CE…)      | |
| `{{TITULAR_NUM_DOC}}`          | número de documento                   | |
| `{{TITULAR_CIUDAD}}`           | ciudad de domicilio                   | |
| `{{TITULAR_EMAIL}}`            | correo (también = firmante)           | |
| `{{TITULAR_EN_REPRESENTACION}}` | texto opcional, ej. " o en representación de X"; vacío si actúa en nombre propio | |

## LA EMPRESA (cliente de Creditia que solicita la consulta)

| Variable                     | Fuente en la BD          |
|------------------------------|--------------------------|
| `{{EMPRESA_RAZON_SOCIAL}}`  | `Company.name`           |
| `{{EMPRESA_NIT}}`           | `Company.nit`            |

## CREDITIA (operador tecnológico) — valores fijos

Coinciden con las constantes de Creditia (`creditia.constants.ts`) y `LOGO_URL`.

| Variable                | Origen                    |
|-------------------------|---------------------------|
| `{{PROVEEDOR_NIT}}`    | CREDITIA_PARTY.nit        |
| `{{PROVEEDOR_CIUDAD}}` | CREDITIA_PARTY.city       |
| `{{LOGO_URL}}`         | env LOGO_URL              |

## Firma

Solo firma **el titular** (un firmante). Creditia y la empresa no firman este
documento — es una autorización unilateral del titular.

## Marco legal citado

- **Ley 1581 de 2012** + **Decreto 1377 de 2013** — protección de datos personales.
- **Ley 1266 de 2008** — Habeas Data financiero (centrales de riesgo).
- **Ley 527 de 1999** / **Decreto 2364 de 2012** — validez de la firma electrónica.
