import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AdminGuard } from './admin.guard.js';
import { PlatformAdminRepository } from './platform-admin.repository.js';
import { CompanyAccessGuard } from './company-access.guard.js';
import { CompanyAccessRepository } from './company-access.repository.js';
import { ContractSignedGuard } from './contract-signed.guard.js';

/**
 * Módulo de autorización compartido y global.
 *
 * Expone:
 *  - AdminGuard (+ PlatformAdminRepository): autorización de super-admin del
 *    portal, vía @AdminOnly() / @UseGuards(AdminGuard).
 *  - CompanyAccessGuard (+ CompanyAccessRepository): autorización por empresa,
 *    vía @CompanyScoped(), para los endpoints `/companies/:companyId/*`.
 *
 * Es @Global() para que cualquier controller pueda usar los decoradores sin
 * importar este módulo.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    AdminGuard,
    PlatformAdminRepository,
    CompanyAccessGuard,
    CompanyAccessRepository,
    ContractSignedGuard,
  ],
  exports: [
    AdminGuard,
    PlatformAdminRepository,
    CompanyAccessGuard,
    CompanyAccessRepository,
    ContractSignedGuard,
  ],
})
export class AuthorizationModule {}
