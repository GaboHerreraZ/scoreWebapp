import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository.js';
import { CompaniesRepository } from '../companies/companies.repository.js';
import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { FilterProfileDto } from './dto/filter-profile.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

const ADMIN_ROLE_CODE = 'administrator';
const ACTIVE_STATUS_CODE = 'active';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly repository: ProfilesRepository,
    private readonly companiesRepository: CompaniesRepository,
  ) {}

  async create(dto: CreateProfileDto) {
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(
        `Profile with email "${dto.email}" already exists`,
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
      throw new NotFoundException(`Profile with id=${id} not found`);
    }

    const userCompany = profile.userCompanies[0] ?? null;

    let permissions = {
      canAddUser: false,
      canAddCustomer: false,
      canMakeAiAnalysis: false,
      canExportExcel: false,
      subscriptionActive: false,
      canEditTheme: false,
      dashboardLevel: '',
      supportLevel: '',
      emailNotification: false,
      subscriptionStatus: '',
      hasSubscription: false,
      canExtractPdf: false,
    };

    if (userCompany) {
      const usageResult =
        await this.companiesRepository.getSubscriptionWithUsage(
          userCompany.companyId,
        );

      const isAdmin = userCompany.role?.code === ADMIN_ROLE_CODE;
      const susbcriptionStatusCode = userCompany.company.companySubscriptions[0]?.status?.code
      const subscriptionActive =
         susbcriptionStatusCode ===
        ACTIVE_STATUS_CODE;

      if (usageResult) {
        const { subscription, usage } = usageResult;

        const usersRemaining = subscription.maxUsers - usage.usersCount;
        const customersUnlimited = subscription.maxCustomers === null;
        const customersRemaining = customersUnlimited
          ? null
          : (subscription.maxCustomers ?? 0) - usage.customersCount;
        const aiUnlimited = subscription.maxAiAnalysisPerMonth === null;
        const aiRemaining = aiUnlimited
          ? null
          : (subscription.maxAiAnalysisPerMonth ?? 0) -
          usage.aiAnalysesThisMonth;

        const extractPdfUnlimited = subscription.maxPdfExtractionsPerMonth === null;


        const extractPdfRemaining = extractPdfUnlimited
          ? null
          : (subscription.maxPdfExtractionsPerMonth ?? 0) -
          usage.pdfExtractionsThisMonth;


        permissions = {
          canAddUser: subscriptionActive && isAdmin && usersRemaining > 0,
          canAddCustomer:
            subscriptionActive &&
            (customersUnlimited || (customersRemaining ?? 0) > 0),
          canMakeAiAnalysis:
            subscriptionActive && (aiUnlimited || (aiRemaining ?? 0) > 0),
          canExtractPdf:  subscriptionActive && (extractPdfUnlimited || (extractPdfRemaining ?? 0) > 0),
          canExportExcel: subscriptionActive && subscription.excelReports,
          subscriptionActive,
          canEditTheme: subscription.themeCustomization,
          dashboardLevel: subscription.dashboardLevel.code,
          supportLevel: subscription.supportLevel.code,
          emailNotification: subscription.emailNotifications,
          subscriptionStatus: susbcriptionStatusCode,
          hasSubscription: true
        };
      } else {
        permissions = { ...permissions, subscriptionActive };
      }
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
      throw new NotFoundException(`Profile with id=${id} not found`);
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
      throw new NotFoundException(`Profile with id=${id} not found`);
    }

    const hasRelated = await this.repository.hasRelatedRecords(id);
    if (hasRelated) {
      throw new ConflictException(
        'Cannot delete: this profile has associated companies',
      );
    }

    return this.repository.delete(id);
  }

  async findCompanies(profileId: string, filters: PaginationDto) {
    const profile = await this.repository.findByIdSingle(profileId);
    if (!profile) {
      throw new NotFoundException(`Profile with id=${profileId} not found`);
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
      throw new NotFoundException(`Profile with id=${profileId} not found`);
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
