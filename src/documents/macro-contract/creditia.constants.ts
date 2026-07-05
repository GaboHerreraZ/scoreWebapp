/**
 * Datos fijos de Creditia como parte ("EL PROVEEDOR") del contrato macro. Son
 * constantes del negocio (no cambian por ambiente), por eso van quemados aquí y
 * no en variables de entorno. Rellenan las variables PROVEEDOR_* de la
 * plantilla. Creditia NO firma electrónicamente (su firma va pre-impresa en la
 * plantilla); solo el cliente firma, por eso aquí no hay email de firmante.
 *
 * Lo que SÍ es configurable por ambiente (token, template_id, LOGO_URL) vive en
 * variables de entorno, no aquí.
 */
export const CREDITIA_PARTY = {
  legalName: 'Creditia S.A.S.',
  nit: '901234567-8',
  city: 'Bucaramanga',
  signerName: 'Oscar Rueda Serrano',
} as const;
