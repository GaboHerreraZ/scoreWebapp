import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository.js';
import { AnalysisPacksRepository } from '../analysis-packs/analysis-packs.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { FilterProfileDto } from './dto/filter-profile.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly repository: ProfilesRepository,
    private readonly analysisPacksRepository: AnalysisPacksRepository,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  /** Créditos disponibles de una empresa (bolsas activas y vigentes con saldo). */
  private async getAvailableCredits(companyId: string): Promise<number> {
    const activeStatus = await this.parametersRepository.findByTypeAndCode(
      'analysis_pack_status',
      'active',
    );
    if (!activeStatus) return 0;

    const packs = await this.analysisPacksRepository.findActivePacksWithBalance(
      companyId,
      activeStatus.id,
    );
    return packs.reduce(
      (sum, p) => sum + (p.quantityPurchased - p.quantityConsumed),
      0,
    );
  }

  async findAll(filters: FilterProfileDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ProfileWhereInput = {};

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw new NotFoundException(`Perfil con id=${id} no encontrado`);
    }

    const userCompany = profile.userCompanies[0] ?? null;

    // Permisos en el modelo de bolsas: las acciones que consumen un crédito
    // (crear estudio, y por extensión el IA/extracción que cuelgan de él)
    // requieren saldo disponible. El resto (usuarios, customers, exportar) ya no
    // tiene tope por plan.
    let permissions = {
      canAddCreditStudy: false,
      canAddUser: true,
      canMakeAiAnalysis: false,
      hasCredits: false,
      availableCredits: 0,
      canExtractPdf: false,
    };

    // Estado de onboarding para el enrutamiento post-login del front. Distingue
    // la ventana entre pagar y que el webhook confirme, para no ofrecer comprar
    // de nuevo (evita doble compra):
    //   'no_pack'          → nunca compró → pantalla de elegir plan.
    //   'payment_pending'  → pagó/inició compra, esperando webhook → "pago en proceso".
    //   'pending_contract' → bolsa activa pero contrato macro sin firmar →
    //                        redirigir al signUrl de Zapsign (ContractSignedGuard
    //                        bloquea las rutas operativas hasta la firma).
    //   'ready'            → bolsa activa + contrato firmado → dashboard.
    let onboardingStatus:
      | 'no_pack'
      | 'payment_pending'
      | 'pending_contract'
      | 'ready' = 'no_pack';

    // Contrato macro de la empresa. La fuente de verdad de "firmado" es signedAt
    // (mismo criterio que ContractSignedGuard), no el código de estado.
    const signature = userCompany?.company.contractSignature ?? null;
    const contract = {
      isSigned: !!signature?.signedAt,
      // 'not_sent' = aún no se ha generado el documento (p. ej. sin pago
      // confirmado todavía); el resto son los códigos de company_contract_status.
      status: signature ? (signature.status?.code ?? null) : 'not_sent',
      statusLabel: signature?.status?.label ?? null,
      // URL de firma en Zapsign a la que el front debe redirigir cuando
      // isSigned=false y hay documento pendiente.
      signUrl: signature?.signUrl ?? null,
      sentAt: signature?.sentAt ?? null,
      signedAt: signature?.signedAt ?? null,
      refusedAt: signature?.refusedAt ?? null,
      refusedReason: signature?.refusedReason ?? null,
      // Hay PDF firmado disponible para ver/descargar. El perfil NO trae la URL:
      // el bucket es privado y la URL firmada caduca (~1h), así que quedaría
      // muerta en una sesión larga. El front pide una fresca al abrirlo, en
      // GET /companies/:companyId/contract/download.
      hasSignedDocument: !!signature?.signedAt,
    };

    if (userCompany) {
      const availableCredits = await this.getAvailableCredits(
        userCompany.companyId,
      );
      // Sin contrato firmado el guard rechaza las rutas operativas: los permisos
      // deben reflejarlo para que el front no ofrezca acciones que darían 403.
      const hasCredits = availableCredits > 0;
      const canOperate = hasCredits && contract.isSigned;

      permissions = {
        canAddCreditStudy: canOperate,
        canMakeAiAnalysis: canOperate,
        canExtractPdf: canOperate,
        canAddUser: true,
        hasCredits,
        availableCredits,
      };

      const { hasActive, hasPending } =
        await this.analysisPacksRepository.getOnboardingPackState(
          userCompany.companyId,
        );
      onboardingStatus = hasActive
        ? contract.isSigned
          ? 'ready'
          : 'pending_contract'
        : hasPending
          ? 'payment_pending'
          : 'no_pack';
    }

    const { userCompanies, ...rest } = profile;
    const company = userCompanies[0];

    return {
      ...rest,
      role: rest.role?.code,
      roleName: rest.role?.label,
      hasCompany: userCompanies.length > 0,
      isUserActiveInCompany: company.isActive,
      companyId: company.companyId,
      companyName: company.company.name,
      companyCity: company.company.city,
      companyNit: company.company.nit,
      isOnboardingReady: company.company.isOnboardingReady,
      onboardingStatus,
      contract,
      permissions,
    };
  }

  async update(id: string, dto: UpdateProfileDto) {
    const profile = await this.repository.findByIdSingle(id);
    if (!profile) {
      throw new NotFoundException(`Perfil con id=${id} no encontrado`);
    }

    return this.repository.update(id, {
      name: dto.name,
      lastName: dto.lastName,
      phone: dto.phone,
      roleId: dto.roleId,
      position: dto.position,
      identificationTypeId: dto.identificationTypeId,
      identificationNumber: dto.identificationNumber,
      metadata: dto.metadata as Prisma.InputJsonValue,
    });
  }

  async remove(id: string) {
    const profile = await this.repository.findByIdSingle(id);
    if (!profile) {
      throw new NotFoundException(`Perfil con id=${id} no encontrado`);
    }

    const hasRelated = await this.repository.hasRelatedRecords(id);
    if (hasRelated) {
      throw new ConflictException(
        'No se puede eliminar: este perfil tiene empresas asociadas',
      );
    }

    return this.repository.delete(id);
  }

  async findCompanies(profileId: string, filters: PaginationDto) {
    const profile = await this.repository.findByIdSingle(profileId);
    if (!profile) {
      throw new NotFoundException(`Perfil con id=${profileId} no encontrado`);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const { data, total } = await this.repository.findCompanies({
      userId: profileId,
      skip,
      take: limit,
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findInvitedUsers(profileId: string, filters: PaginationDto) {
    const profile = await this.repository.findByIdSingle(profileId);
    if (!profile) {
      throw new NotFoundException(`Perfil con id=${profileId} no encontrado`);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const { data, total } = await this.repository.findInvitedUsers({
      userId: profileId,
      skip,
      take: limit,
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
