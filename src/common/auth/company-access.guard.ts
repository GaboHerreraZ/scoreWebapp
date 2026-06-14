import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { CompanyAccessRepository } from './company-access.repository.js';
import { PlatformAdminRepository } from './platform-admin.repository.js';

/**
 * Autoriza el acceso a los endpoints con ámbito de empresa
 * (`/companies/:companyId/*`). Corre DESPUÉS del SupabaseAuthGuard global, que
 * ya validó el token y puso request.user.
 *
 * Permite el paso si:
 *  - el usuario es miembro ACTIVO de la empresa (cliente legítimo), o
 *  - el usuario es un PlatformAdmin activo → IMPERSONATION de soporte: puede
 *    operar sobre cualquier empresa sin pertenecer a user_companies.
 *
 * Cuando el acceso es por la vía admin se marca request.isImpersonating = true
 * y se registra en el log (auditoría de soporte). Respeta @Public().
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  private readonly logger = new Logger(CompanyAccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly companyAccessRepository: CompanyAccessRepository,
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id as string | undefined;
    if (!userId) {
      throw new ForbiddenException('No autenticado');
    }

    const companyId = request.params?.companyId as string | undefined;
    if (!companyId) {
      // El guard se aplicó a una ruta sin :companyId: es un error de cableado.
      throw new BadRequestException(
        'No se pudo determinar la empresa de la solicitud',
      );
    }

    // 1. Cliente legítimo: miembro activo de la empresa.
    const isMember = await this.companyAccessRepository.isActiveMember(
      userId,
      companyId,
    );
    if (isMember) {
      return true;
    }

    // 2. Soporte: PlatformAdmin operando sobre la empresa (impersonation).
    const isAdmin = await this.platformAdminRepository.isPlatformAdmin(userId);
    if (isAdmin) {
      request.isImpersonating = true;
      this.logger.warn(
        `IMPERSONATION: PlatformAdmin ${userId} accede a empresa ${companyId} ` +
          `[${request.method} ${request.originalUrl ?? request.url}]`,
      );
      return true;
    }

    throw new ForbiddenException('No tienes acceso a esta empresa');
  }
}
