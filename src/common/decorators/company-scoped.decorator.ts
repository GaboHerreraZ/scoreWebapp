import { applyDecorators, UseGuards } from '@nestjs/common';
import { CompanyAccessGuard } from '../auth/company-access.guard.js';

/**
 * Marca un controller/handler con ámbito de empresa: aplica CompanyAccessGuard,
 * que exige ser miembro activo de la empresa (`:companyId`) o PlatformAdmin
 * (impersonation de soporte). Usar en los controllers `/companies/:companyId/*`.
 */
export const CompanyScoped = () => applyDecorators(UseGuards(CompanyAccessGuard));
