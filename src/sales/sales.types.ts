/**
 * Quién está consultando el módulo. El portal lo comparten dos perfiles con
 * alcances distintos: el 'admin' ve el programa completo, el 'sales' solo lo
 * suyo. Todo endpoint del módulo se apoya en esto para acotar el alcance.
 *
 * Vive aparte de los services porque lo usan los dos y SalesService depende de
 * SalesCommissionsService (para causar el backlog al vincular una empresa).
 */
export interface SalesCaller {
  platformAdminId: string;
  name: string | null;
  isAdmin: boolean;
  /** Ficha de vendedor del que consulta, si la tiene. */
  salesRepId: string | null;
}

/** Días que tiene el admin para asignarle vendedor a una empresa nueva. */
export const REFERRAL_ASSIGNMENT_WINDOW_DAYS = 5;

/** Fin de la ventana de asignación de una empresa. */
export function referralWindowExpiresAt(companyCreatedAt: Date): Date {
  return new Date(
    companyCreatedAt.getTime() +
      REFERRAL_ASSIGNMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}
