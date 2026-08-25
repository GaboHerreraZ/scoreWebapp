import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformAdminRepository } from './platform-admin.repository.js';

export const PLATFORM_ROLES_KEY = 'platformRoles';

/**
 * Restringe un endpoint a ciertos roles del portal (Parameter
 * 'platform_admin_role': admin | support | sales). Se usa junto con AdminGuard,
 * que ya verificó que quien llama es un PlatformAdmin activo.
 */
export const PlatformRoles = (...roles: string[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<string[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Sin @PlatformRoles el guard no opina: AdminGuard ya hizo lo suyo.
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id as string | undefined;
    if (!userId) {
      throw new ForbiddenException('No autenticado');
    }

    const admin =
      await this.platformAdminRepository.findByUserIdWithRole(userId);
    if (!admin?.isActive || !admin.role || !roles.includes(admin.role.code)) {
      throw new ForbiddenException(
        'Tu rol del portal no tiene acceso a esta sección',
      );
    }

    return true;
  }
}
