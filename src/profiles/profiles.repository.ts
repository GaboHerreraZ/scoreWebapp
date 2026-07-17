import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async findByIdSingle(id: string) {
    return this.prisma.profile.findUnique({
      where: { id },
    });
  }

  async findById(id: string) {
    return this.prisma.profile.findUnique({
      where: { id },
      include: {
        role: true,
        userCompanies: {
          select: {
            companyId: true,
            isActive: true,
            role: {
              select: {
                id: true,
                code: true,
                label: true,
              },
            },
            company: {
              select: {
                city: true,
                nit: true,
                name: true,
                isOnboardingReady: true,
                // Contrato macro: gate de uso de la app (ContractSignedGuard).
                // Uno por empresa; ausente = nunca se envió.
                contractSignature: {
                  select: {
                    signUrl: true,
                    sentAt: true,
                    signedAt: true,
                    refusedAt: true,
                    refusedReason: true,
                    signedFileStoragePath: true,
                    status: { select: { code: true, label: true } },
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
