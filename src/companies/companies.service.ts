import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CompaniesRepository } from './companies.repository.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { FilterCompanyDto } from './dto/filter-company.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CompaniesService {
  constructor(private readonly repository: CompaniesRepository) {}

  async create(dto: CreateCompanyDto, userId: string) {
    const existing = await this.repository.findByNit(dto.nit);
    if (existing) {
      throw new ConflictException(`Company with NIT "${dto.nit}" already exists`);
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
      { userId, roleId: dto.roleId },
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
      throw new NotFoundException(`Company with id=${id} not found`);
    }
    return company;
  }

  async findByUserId(userId: string) {
    return this.repository.findByUserId(userId);
  }

  async update(id: string, dto: UpdateCompanyDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Company with id=${id} not found`);
    }

    if (dto.nit && dto.nit !== current.nit) {
      const duplicate = await this.repository.findByNit(dto.nit);
      if (duplicate) {
        throw new ConflictException(`Company with NIT "${dto.nit}" already exists`);
      }
    }

    return this.repository.update(id, {
      name: dto.name,
      nit: dto.nit,
      sectorId: dto.sectorId,
      state: dto.state,
      city: dto.city,
      address: dto.address,
      isActive: dto.isActive,
    });
  }

  async remove(id: string) {
    const company = await this.repository.findById(id);
    if (!company) {
      throw new NotFoundException(`Company with id=${id} not found`);
    }

    const hasRelated = await this.repository.hasRelatedRecords(id);
    if (hasRelated) {
      throw new ConflictException(
        'Cannot delete: this company has associated records',
      );
    }

    return this.repository.delete(id);
  }

  async getAvailablePlans(companyId: string) {
    const { company, plans } = await this.repository.getAvailablePlans(companyId);
    if (!company) {
      throw new NotFoundException(`Company with id=${companyId} not found`);
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
        `Company with id=${companyId} not found or has no active subscription`,
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
          remaining: subscription.maxCustomers !== null
            ? subscription.maxCustomers - usage.customersCount
            : null,
          unlimited: subscription.maxCustomers === null,
        },
        studiesThisMonth: {
          used: usage.studiesThisMonth,
          max: subscription.maxStudiesPerMonth,
          remaining: subscription.maxStudiesPerMonth !== null
            ? subscription.maxStudiesPerMonth - usage.studiesThisMonth
            : null,
          unlimited: subscription.maxStudiesPerMonth === null,
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
      throw new NotFoundException(`Company with id=${companyId} not found`);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {};

    if (filters.search) {
      where.OR = [
        { businessName: { contains: filters.search, mode: 'insensitive' } },
        { identificationNumber: { contains: filters.search, mode: 'insensitive' } },
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
