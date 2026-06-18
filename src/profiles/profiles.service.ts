import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository.js';
import { AnalysisPacksRepository } from '../analysis-packs/analysis-packs.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { CreateProfileDto } from './dto/create-profile.dto.js';
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

  async create(dto: CreateProfileDto) {
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(
        `Ya existe un perfil con el correo "${dto.email}"`,
      );
    }

    return this.repository.create({
      id: dto.id,
      email: dto.email,
      name: dto.name,
      lastName: dto.lastName,
      phone: dto.phone,
      roleId: dto.roleId,
      position: dto.position,
    });
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
      canAddCustomer: true,
      canMakeAiAnalysis: false,
      canExportExcel: true,
      hasCredits: false,
      availableCredits: 0,
      canEditTheme: true,
      emailNotification: true,
      canExtractPdf: false,
    };

    if (userCompany) {
      const availableCredits = await this.getAvailableCredits(
        userCompany.companyId,
      );
      const hasCredits = availableCredits > 0;

      permissions = {
        canAddCreditStudy: hasCredits,
        canMakeAiAnalysis: hasCredits,
        canExtractPdf: hasCredits,
        canAddUser: true,
        canAddCustomer: true,
        canExportExcel: true,
        hasCredits,
        availableCredits,
        canEditTheme: true,
        emailNotification: true,
      };
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
