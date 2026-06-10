import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse } from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard.js';

export const IS_ADMIN_ONLY_KEY = 'isAdminOnly';

/**
 * Marca un endpoint (o controller) como exclusivo del portal de administración.
 *
 * Aplica el AdminGuard (que verifica platform_admins) además de documentar la
 * restricción en Swagger. Se ejecuta DESPUÉS del SupabaseAuthGuard global, por
 * lo que el usuario ya debe estar autenticado.
 *
 * Uso por método:
 *   @Post()
 *   @AdminOnly()
 *   create(...) {}
 *
 * Uso por controller (todos los endpoints admin):
 *   @AdminOnly()
 *   @Controller('admin/...')
 */
export const AdminOnly = () =>
  applyDecorators(
    SetMetadata(IS_ADMIN_ONLY_KEY, true),
    UseGuards(AdminGuard),
    ApiBearerAuth(),
    ApiForbiddenResponse({
      description: 'Requiere ser administrador de la plataforma',
    }),
  );
