import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { CampaignsService } from '../campaigns/campaigns.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import { OnboardingSetupDto } from './dto/onboarding-setup.dto.js';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly campaignsService: CampaignsService,
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: CreateSubscriptionDto) {
    return this.repository.create({
      name: dto.name,
      description: dto.description,
      price: dto.price,
      isMonthly: dto.isMonthly,
      maxUsers: dto.maxUsers,
      maxCompanies: dto.maxCompanies,
      maxCustomers: dto.maxCustomers,
      maxStudiesPerMonth: dto.maxStudiesPerMonth,
      maxAiAnalysisPerMonth: dto.maxAiAnalysisPerMonth,
      dashboardLevelId: dto.dashboardLevelId,
      excelReports: dto.excelReports,
      emailNotifications: dto.emailNotifications,
      themeCustomization: dto.themeCustomization,
      supportLevelId: dto.supportLevelId,
      epaycoPlanId: dto.epaycoPlanId,
      isActive: dto.isActive,
    });
  }

  async findAll() {
    const [subscriptions, activeCampaign] = await Promise.all([
      this.repository.findAllActive(),
      this.campaignsService.findActiveCampaign(),
    ]);

    return {
      data: subscriptions,
      campaign: activeCampaign ?? null,
    };
  }

  async findByName(name: string) {
    return this.repository.findByName(name);
  }

  async findById(id: string) {
    const subscription = await this.repository.findById(id);
    if (!subscription) {
      throw new NotFoundException(`Subscription with id=${id} not found`);
    }
    return subscription;
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Subscription with id=${id} not found`);
    }

    return this.repository.update(id, {
      name: dto.name,
      description: dto.description,
      price: dto.price,
      isMonthly: dto.isMonthly,
      maxUsers: dto.maxUsers,
      maxCompanies: dto.maxCompanies,
      maxCustomers: dto.maxCustomers,
      maxStudiesPerMonth: dto.maxStudiesPerMonth,
      maxAiAnalysisPerMonth: dto.maxAiAnalysisPerMonth,
      dashboardLevelId: dto.dashboardLevelId,
      excelReports: dto.excelReports,
      emailNotifications: dto.emailNotifications,
      themeCustomization: dto.themeCustomization,
      supportLevelId: dto.supportLevelId,
      epaycoPlanId: dto.epaycoPlanId,
      isActive: dto.isActive,
    });
  }

  async remove(id: string) {
    const subscription = await this.repository.findById(id);
    if (!subscription) {
      throw new NotFoundException(`Subscription with id=${id} not found`);
    }

    const hasCompanies = await this.repository.hasCompanies(id);
    if (hasCompanies) {
      throw new ConflictException(
        'Cannot delete: this subscription has associated companies',
      );
    }

    return this.repository.delete(id);
  }

  async onboardingSetup(userId: string, dto: OnboardingSetupDto) {
    // Validate NIT uniqueness
    const existingCompany = await this.prisma.company.findUnique({
      where: { nit: dto.company.nit },
    });
    if (existingCompany) {
      throw new ConflictException(
        `Company with NIT "${dto.company.nit}" already exists`,
      );
    }

    // Get administrator role
    const adminRole = await this.prisma.parameter.findUnique({
      where: { type_code: { type: 'user_company_role', code: 'administrator' } },
    });
    if (!adminRole) {
      throw new BadRequestException(
        'Role parameter "administrator" not found',
      );
    }

    // Run everything in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Upsert profile (may already exist from Supabase sign-up)
      const profile = await tx.profile.upsert({
        where: { id: userId },
        update: {
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          email: dto.profile.email,
          phone: dto.profile.phone,
          position: dto.profile.position,
          identificationTypeId: dto.profile.identificationTypeId,
          identificationNumber: dto.profile.identificationNumber,
          roleId: dto.profile.roleId
        },
        create: {
          id: userId,
          email: dto.profile.email,
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          phone: dto.profile.phone,
          position: dto.profile.position,
          identificationTypeId: dto.profile.identificationTypeId,
          identificationNumber: dto.profile.identificationNumber,
          roleId: dto.profile.roleId
        },
      });

      // 2. Create company
      const company = await tx.company.create({
        data: {
          name: dto.company.name,
          nit: dto.company.nit,
          sectorId: dto.company.sectorId,
          state: dto.company.state,
          city: dto.company.city,
          address: dto.company.address,
        },
      });

      // 3. Associate user to company as administrator
      const userCompany = await tx.userCompany.create({
        data: {
          userId,
          companyId: company.id,
          roleId: adminRole.id,
          joinedAt: new Date(),
        },
      });

      return { profile, company, userCompany };
    });

    return result;
  }
}
