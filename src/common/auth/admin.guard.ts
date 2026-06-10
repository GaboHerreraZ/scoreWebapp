import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PlatformAdminRepository } from './platform-admin.repository.js';

/**
 * Autorización del portal de administración.
 *
 * Se ejecuta DESPUÉS del SupabaseAuthGuard global (que ya validó el token y puso
 * request.user). Verifica que el usuario esté registrado y activo en la tabla
 * platform_admins. No es global: se aplica vía @UseGuards(AdminGuard) o el
 * decorador @AdminOnly() en los endpoints/controllers que lo requieran.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id as string | undefined;

    if (!userId) {
      throw new ForbiddenException('No autenticado');
    }

    const isAdmin = await this.platformAdminRepository.isPlatformAdmin(userId);
    if (!isAdmin) {
      throw new ForbiddenException(
        'No tienes acceso al portal de administración',
      );
    }

    return true;
  }
}
