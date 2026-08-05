/**
 * Datos fijos de RUSER CONSULTORES S.A.S. — operador de la plataforma Credit-ia —
 * como parte ("EL PROVEEDOR") del contrato macro y de las autorizaciones. Son
 * constantes del negocio (no cambian por ambiente), por eso van quemados aquí y
 * no en variables de entorno.
 *
 * Solo quedan los datos que las plantillas siguen pidiendo como variable: el
 * contrato macro vigente trae la razón social, el NIT y el representante
 * escritos en su texto, así que de él solo se sustituye la ciudad.
 *
 * Lo que SÍ es configurable por ambiente (tokens, template_id, LOGO_URL, y el
 * email del firmante Creditia) vive en variables de entorno, no aquí.
 */
export const CREDITIA_PARTY = {
  /** {{PROVEEDOR_NIT}} de las autorizaciones (el contrato macro ya lo trae escrito). */
  nit: '901691260',
  /** Domicilio principal de la sociedad → {{PROVEEDOR_CIUDAD}}. */
  city: 'Bucaramanga',
  /**
   * Representante legal. NO es una variable de plantilla: es el nombre con el
   * que se agrega a Creditia como firmante en Zapsign, así que debe coincidir
   * con el usuario registrado en la organización.
   */
  signerName: 'Oscar Rueda Serrano',
} as const;
