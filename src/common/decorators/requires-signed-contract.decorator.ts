import { applyDecorators, UseGuards } from '@nestjs/common';
import { CompanyAccessGuard } from '../auth/company-access.guard.js';
import { ContractSignedGuard } from '../auth/contract-signed.guard.js';

/**
 * Marca una ruta operativa `/companies/:companyId/*` que requiere que la empresa
 * tenga su CONTRATO MACRO firmado. Aplica CompanyAccessGuard (pertenencia) +
 * ContractSignedGuard (gate de firma), en ese orden. Usar en lugar de
 * @CompanyScoped() en las rutas que deben bloquearse hasta la firma (crear
 * estudios de crédito, clientes, etc.). NO usar en las rutas de firma/pago/
 * estado del contrato (crearía un catch-22).
 */
export const RequiresSignedContract = () =>
  applyDecorators(UseGuards(CompanyAccessGuard, ContractSignedGuard));
