import { Prisma } from '../../../generated/prisma/client.js';

/**
 * Serializa un valor de dominio a JSONB para Prisma: devuelve Prisma.JsonNull
 * cuando no hay nada que guardar (null, undefined o arreglo vacío), de modo que
 * la columna quede en NULL en vez de almacenar un literal vacío.
 *
 * Solo para columnas Json NULLABLES: Prisma.JsonNull no es asignable a una
 * columna Json requerida (ahí basta el cast directo a Prisma.InputJsonValue).
 */
export function toJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}
