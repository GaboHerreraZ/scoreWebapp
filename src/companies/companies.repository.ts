import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Se conserva como objeto vacío para no tocar los 8 includes que lo
  // spread-ean; el modelo de bolsas no anexa datos de suscripción a Company.
  private readonly subscriptionInclude = {};

  async create(data: Prisma.CompanyUncheckedCreateInput) {
    return this.prisma.company.create({
      data,
      include: { ...this.subscriptionInclude, sector: true },
    });
  }

  async createWithUserCompany(
    companyData: Prisma.CompanyUncheckedCreateInput,
    userCompanyData: { userId: string; roleId: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: companyData,
        include: { ...this.subscriptionInclude, sector: true },
      });

      await tx.userCompany.create({
        data: {
          userId: userCompanyData.userId,
          companyId: company.id,
          roleId: userCompanyData.roleId,
          joinedAt: new Date(),
        },
      });

      return company;
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.CompanyWhereInput;
    orderBy?: Prisma.CompanyOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        skip,
        take,
        where,
        orderBy,
        include: { ...this.subscriptionInclude, sector: true },
      }),
      this.prisma.company.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string) {
    return this.prisma.company.findUnique({
      where: { id },
      include: { ...this.subscriptionInclude, sector: true },
    });
  }

  async findByIdWithDetails(id: string) {
    return this.prisma.company.findUnique({
      where: { id },
      include: {
        ...this.subscriptionInclude,
        sector: true,
        userCompanies: {
          include: {
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                lastName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  async findByUserId(userId: string) {
    return this.prisma.company.findMany({
      where: {
        userCompanies: { some: { userId } },
      },
      include: {
        ...this.subscriptionInclude,
        sector: true,
        userCompanies: {
          include: {
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                lastName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  async findByNit(nit: string) {
    return this.prisma.company.findUnique({ where: { nit } });
  }

  async update(id: string, data: Prisma.CompanyUncheckedUpdateInput) {
    return this.prisma.company.update({
      where: { id },
      data,
      include: { ...this.subscriptionInclude, sector: true },
    });
  }

  async updateLogoUrl(id: string, logoUrl: string | null) {
    return this.prisma.company.update({
      where: { id },
      data: { logoUrl },
      include: { ...this.subscriptionInclude, sector: true },
    });
  }

  async delete(id: string) {
    return this.prisma.company.delete({ where: { id } });
  }

  async hasRelatedRecords(id: string): Promise<boolean> {
    const [userCompanies, customers, creditStudies, analysisPacks] =
      await Promise.all([
        this.prisma.userCompany.count({ where: { companyId: id } }),
        this.prisma.customer.count({ where: { companyId: id } }),
        this.prisma.creditStudy.count({ where: { companyId: id } }),
        this.prisma.analysisPack.count({ where: { companyId: id } }),
      ]);

    return userCompanies + customers + creditStudies + analysisPacks > 0;
  }

  async getRoleId(code: string): Promise<number | null> {
    const param = await this.prisma.parameter.findFirst({
      where: { type: 'user_company_role', code },
    });
    return param?.id ?? null;
  }

  async findCustomersByCompanyId(params: {
    companyId: string;
    skip: number;
    take: number;
    where?: Prisma.CustomerWhereInput;
    orderBy?: Prisma.CustomerOrderByWithRelationInput;
  }) {
    const { companyId, skip, take, where, orderBy } = params;

    const fullWhere: Prisma.CustomerWhereInput = { ...where, companyId };

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        skip,
        take,
        where: fullWhere,
        orderBy,
        include: { personType: true },
      }),
      this.prisma.customer.count({ where: fullWhere }),
    ]);

    return { data, total };
  }
}
