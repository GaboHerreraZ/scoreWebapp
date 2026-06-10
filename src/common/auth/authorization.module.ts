import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AdminGuard } from './admin.guard.js';
import { PlatformAdminRepository } from './platform-admin.repository.js';

/**
 * Módulo de autorización compartido y global.
 *
 * Expone el AdminGuard (autorización de super-admin del portal) y su repositorio
 * a todo el contenedor DI, para que cualquier controller pueda usar el decorador
 * @AdminOnly() (que aplica @UseGuards(AdminGuard)) sin importar este módulo.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AdminGuard, PlatformAdminRepository],
  exports: [AdminGuard, PlatformAdminRepository],
})
export class AuthorizationModule {}
