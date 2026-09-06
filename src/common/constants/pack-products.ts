// Productos de las bolsas (Parameter 'pack_product_type'). Cada producto tiene
// su precio y su pool: el FIFO de consumo nunca cruza de producto.
// creditStudy = estudios completos (EEFF + capacidad); bureauCheck = consultas
// de riesgo crediticio.
export const PACK_PRODUCT_CODES = ['creditStudy', 'bureauCheck'] as const;
export type PackProductCode = (typeof PACK_PRODUCT_CODES)[number];
