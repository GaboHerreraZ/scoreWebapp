import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ProfileUncheckedCreateInput) {
    return this.prisma.profile.create({ data });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.ProfileWhereInput;
    orderBy?: Prisma.ProfileOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.profile.findMany({ skip, take, where, orderBy }),
      this.prisma.profile.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string) {
    return this.prisma.profile.findUnique({
      where: { id },
      include: {
        role: true,
        userCompanies: {
          select: {
            companyId: true,
            company: {
              select: {
                city: true,
                nit: true,
                name: true,
                companySubscriptions: {
                  where: { isCurrent: true },
                  take: 1,
                  select: {
                    startDate: true,
                    endDate: true,
                    isCurrent: true,
                    status: {
                      select: {
                        code: true,
                        label: true,
                        id: true,
                      },
                    },
                    subscription: {
                      select: {
                        id: true,
                        dashboardLevel: {
                          select: {
                            id: true,
                            code: true,
                          },
                        },
                        isActive: true,
                        emailNotifications: true,
                        excelReports: true,
                        isMonthly: true,
                        maxCompanies: true,
                        maxUsers: true,
                        maxStudiesPerMonth: true,
                        supportLevel: {
                          select: {
                            id: true,
                            code: true,
                          },
                        },
                        maxCustomers: true,
                        themeCustomization: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.profile.findUnique({ where: { email } });
  }

  async update(id: string, data: Prisma.ProfileUncheckedUpdateInput) {
    return this.prisma.profile.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.profile.delete({ where: { id } });
  }

  async hasRelatedRecords(id: string): Promise<boolean> {
    const userCompanies = await this.prisma.userCompany.count({
      where: { userId: id },
    });

    return userCompanies > 0;
  }

  async findCompanies(params: { userId: string; skip: number; take: number }) {
    const { userId, skip, take } = params;

    const where: Prisma.UserCompanyWhereInput = { userId };

    const [data, total] = await Promise.all([
      this.prisma.userCompany.findMany({
        skip,
        take,
        where,
        include: {
          company: { include: { sector: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.userCompany.count({ where }),
    ]);

    return { data, total };
  }

  async findInvitedUsers(params: {
    userId: string;
    skip: number;
    take: number;
  }) {
    const { userId, skip, take } = params;

    const where: Prisma.UserCompanyWhereInput = { invitedBy: userId };

    const [data, total] = await Promise.all([
      this.prisma.userCompany.findMany({
        skip,
        take,
        where,
        include: {
          user: true,
          company: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.userCompany.count({ where }),
    ]);

    return { data, total };
  }
}
