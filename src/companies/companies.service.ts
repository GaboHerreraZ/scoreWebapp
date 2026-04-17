import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { CompaniesRepository } from './companies.repository.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { FilterCompanyDto } from './dto/filter-company.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

const LOGO_BUCKET = 'company-logos';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly supabaseService: SupabaseService,
  ) {}

  async create(dto: CreateCompanyDto, userId: string) {
    const existing = await this.repository.findByNit(dto.nit);
    if (existing) {
      throw new ConflictException(
        `Ya existe una empresa con NIT "${dto.nit}"`,
      );
    }

    const adminRoleId = await this.repository.getRoleId('administrator');
    if (!adminRoleId) {
      throw new BadRequestException(
        'Parámetro de rol "administrador" no encontrado',
      );
    }

    return this.repository.createWithUserCompany(
      {
        name: dto.name,
        nit: dto.nit,
        sectorId: dto.sectorId,
        state: dto.state,
        city: dto.city,
        address: dto.address,
        isActive: dto.isActive,
      },
      { userId, roleId: adminRoleId },
    );
  }

  async findAll(filters: FilterCompanyDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CompanyWhereInput = {};

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { nit: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { name: 'asc' },
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
    const company = await this.repository.findByIdWithDetails(id);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    let logoSignedUrl: string | null = null;
    if (company.logoUrl) {
      logoSignedUrl = await this.supabaseService.createSignedUrl(
        LOGO_BUCKET,
        company.logoUrl,
      );
    }

    return { ...company, logoSignedUrl };
  }

  async findByUserId(userId: string) {
    const companies = await this.repository.findByUserId(userId);

    return Promise.all(
      companies.map(async (company) => {
        let logoSignedUrl: string | null = null;
        if (company.logoUrl) {
          logoSignedUrl = await this.supabaseService.createSignedUrl(
            LOGO_BUCKET,
            company.logoUrl,
          );
        }
        return { ...company, logoSignedUrl };
      }),
    );
  }

  async update(id: string, dto: UpdateCompanyDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    if (dto.nit && dto.nit !== current.nit) {
      const duplicate = await this.repository.findByNit(dto.nit);
      if (duplicate) {
        throw new ConflictException(
          `Ya existe una empresa con NIT "${dto.nit}"`,
        );
      }
    }

    return this.repository.update(id, {
      name: dto.name,
      nit: dto.nit,
      sectorId: dto.sectorId,
      state: dto.state,
      city: dto.city,
      address: dto.address,
      accountTypeId: dto.accountTypeId,
      accountBankId: dto.accountBankId,
      accountNumber: dto.accountNumber,
      billingName: dto.billingName,
      billingLastName: dto.billingLastName,
      billingDocTypeId: dto.billingDocTypeId,
      billingDocNumber: dto.billingDocNumber,
      billingEmail: dto.billingEmail,
      billingAddress: dto.billingAddress,
      billingState: dto.billingState,
      billingCity: dto.billingCity,
      billingPhone: dto.billingPhone,
      isActive: dto.isActive,
    });
  }

  async uploadLogo(id: string, file: Express.Multer.File) {
    const company = await this.repository.findById(id);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    const ext = file.originalname.split('.').pop() ?? 'png';
    const storagePath = `${id}/logo.${ext}`;

    await this.supabaseService.uploadFile(
      LOGO_BUCKET,
      storagePath,
      file.buffer,
      file.mimetype,
    );

    await this.repository.updateLogoUrl(id, storagePath);

    const logoSignedUrl = await this.supabaseService.createSignedUrl(
      LOGO_BUCKET,
      storagePath,
    );

    return { logoUrl: storagePath, logoSignedUrl };
  }

  async remove(id: string) {
    const company = await this.repository.findById(id);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    const hasRelated = await this.repository.hasRelatedRecords(id);
    if (hasRelated) {
      throw new ConflictException(
        'No se puede eliminar: la empresa tiene registros asociados',
      );
    }

    return this.repository.delete(id);
  }

  async getAvailablePlans(companyId: string) {
    const { company, plans } =
      await this.repository.getAvailablePlans(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    const currentSubscriptionId =
      company.companySubscriptions[0]?.subscriptionId ?? null;

    return {
      currentSubscriptionId,
      plans: plans.map((plan) => ({
        ...plan,
        isCurrent: plan.id === currentSubscriptionId,
      })),
    };
  }

  async getSubscriptionUsage(companyId: string) {
    const result = await this.repository.getSubscriptionWithUsage(companyId);
    if (!result) {
      throw new NotFoundException(
        `Empresa con id=${companyId} no encontrada o no tiene suscripción activa`,
      );
    }

    const { subscription, usage } = result;

    return {
      subscription,
      usage: {
        users: {
          used: usage.usersCount,
          max: subscription.maxUsers,
          remaining: subscription.maxUsers - usage.usersCount,
        },
        customers: {
          used: usage.customersCount,
          max: subscription.maxCustomers,
          remaining:
            subscription.maxCustomers !== null
              ? subscription.maxCustomers - usage.customersCount
              : null,
          unlimited: subscription.maxCustomers === null,
        },
        studiesThisMonth: {
          used: usage.studiesThisMonth,
          max: subscription.maxStudiesPerMonth,
          remaining:
            subscription.maxStudiesPerMonth !== null
              ? subscription.maxStudiesPerMonth - usage.studiesThisMonth
              : null,
          unlimited: subscription.maxStudiesPerMonth === null,
        },
        aiAnalysesThisMonth: {
          used: usage.aiAnalysesThisMonth,
          max: subscription.maxAiAnalysisPerMonth,
          remaining:
            subscription.maxAiAnalysisPerMonth !== null
              ? subscription.maxAiAnalysisPerMonth - usage.aiAnalysesThisMonth
              : null,
          unlimited: subscription.maxAiAnalysisPerMonth === null,
        },
        pdfExtractionsThisMonth: {
          used: usage.pdfExtractionsThisMonth,
          max: subscription.maxPdfExtractionsPerMonth,
          remaining:
            subscription.maxPdfExtractionsPerMonth !== null
              ? subscription.maxPdfExtractionsPerMonth -
                usage.pdfExtractionsThisMonth
              : null,
          unlimited: subscription.maxPdfExtractionsPerMonth === null,
        },
      },
      features: {
        dashboardLevel: subscription.dashboardLevel,
        dashboardLevelId: subscription.dashboardLevelId,
        excelReports: subscription.excelReports,
        emailNotifications: subscription.emailNotifications,
        themeCustomization: subscription.themeCustomization,
        supportLevel: subscription.supportLevel,
        supportLevelId: subscription.supportLevelId,
      },
    };
  }

  async findCustomers(companyId: string, filters: PaginationDto) {
    const company = await this.repository.findById(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {};

    if (filters.search) {
      where.OR = [
        { businessName: { contains: filters.search, mode: 'insensitive' } },
        {
          identificationNumber: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    const { data, total } = await this.repository.findCustomersByCompanyId({
      companyId,
      skip,
      take: limit,
      where,
      orderBy: { businessName: 'asc' },
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
