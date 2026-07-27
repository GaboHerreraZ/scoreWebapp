/**
 * Estados desde los que un estudio queda BLOQUEADO para editar, eliminar,
 * re-analizar, re-cargar EEFF o resetear: una vez el usuario confirma (o
 * rechaza) el estudio realizado, ya no se toca. Cubre el resto del flujo de
 * cierre/firma del pagaré.
 */
export const LOCKED_STUDY_STATUSES: ReadonlySet<string> = new Set([
  'confirmed',
  'rejected',
  'pendingSignature',
  'closed',
]);
