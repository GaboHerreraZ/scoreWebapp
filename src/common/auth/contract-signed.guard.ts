import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { CompanyAccessRepository } from './company-access.repository.js';
import { PlatformAdminRepository } from './platform-admin.repository.js';

/**
 * Exige que la empresa (`:companyId`) tenga su CONTRATO MACRO firmado antes de
 * operar. El estado se DERIVA de ContractSignature.signedAt (no hay flag en
 * Company). Se aplica SELECTIVAMENTE (vía @RequiresSignedContract()) solo a las
 * rutas operativas —crear estudios, clientes, etc.—, NUNCA a las de firma, pago
 * o consulta de estado, para no crear un catch-22 (no podrías firmar porque no
 * has firmado).
 *
 * Corre DESPUÉS de CompanyAccessGuard (ya validó pertenencia). Un PlatformAdmin
 * (soporte) NO queda bloqueado por este gate: puede operar aunque falte firma.
 */
@Injectable()
export class ContractSignedGuard implements CanActivate {
  private readonly logger = new Logger(ContractSignedGuard.name);

  constructor(
    private readonly companyAccessRepository: CompanyAccessRepository,
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id as string | undefined;
    const companyId = request.params?.companyId as string | undefined;

    if (!companyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa de la solicitud',
      );
    }

    // Soporte (PlatformAdmin) no queda bloqueado por el gate de firma.
    if (
      request.isImpersonating === true ||
      (userId && (await this.platformAdminRepository.isPlatformAdmin(userId)))
    ) {
      return true;
    }

    const signed =
      await this.companyAccessRepository.hasSignedContract(companyId);
    if (!signed) {
      throw new ForbiddenException(
        'La empresa tiene el contrato macro pendiente de firma. ' +
          'Firma el contrato para activar la cuenta.',
      );
    }
    return true;
  }
}
