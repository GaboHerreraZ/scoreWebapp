/**
 * Constantes de negocio de la factura electrónica.
 *
 * Aquí NO hay datos del emisor: el proveedor los toma de la empresa configurada
 * en su cuenta (la sucursal es opcional en el payload y, si no se manda, la
 * resuelve él). Mandar una copia local solo abriría la puerta a que las dos
 * versiones se desincronicen y la DIAN rechace por incoherencia.
 *
 * Lo que cambia por ambiente vive en variables de entorno (token, modo), y la
 * resolución DIAN vive en la tabla einvoice_resolutions porque se rota.
 */

/** Ítem que se factura: la bolsa de consultas. Un solo concepto por ahora. */
export const INVOICE_ITEM = {
  code: 'PACK-CONSULTAS',
  name: 'Bolsa de análisis de crédito',
} as const;

// El medio de pago NO es constante: sale de la franquicia que reportó la
// pasarela en cada compra. Ver domain/payment-means.ts.
