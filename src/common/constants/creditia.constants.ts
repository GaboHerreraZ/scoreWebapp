/**
 * Datos fijos de RUSER CONSULTORES S.A.S. — operador de la plataforma Credit-ia —
 * como parte ("EL PROVEEDOR") de las autorizaciones que firma el titular. Son
 * constantes del negocio (no cambian por ambiente), por eso van quemados aquí y
 * no en variables de entorno.
 *
 * Lo que SÍ es configurable por ambiente (tokens, template_id, LOGO_URL) vive en
 * variables de entorno, no aquí.
 */
export const CREDITIA_PARTY = {
  /** {{PROVEEDOR_NIT}} de las autorizaciones. */
  nit: '901691260',
  /** Domicilio principal de la sociedad → {{PROVEEDOR_CIUDAD}}. */
  city: 'Bucaramanga',
} as const;
