import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    createdByAdmin: true,
    companySubscriptions: { include: { company: true, status: true } },
  } as const;

  async create(data: Prisma.SubscriptionUncheckedCreateInput) {
    return this.prisma.subscription.create({
      data,
      include: this.defaultInclude,
    });
  }

  async findAllActive() {
    return this.prisma.subscription.findMany({
      where: { isActive: true },
      orderBy: { maxStudiesPerMonth: 'asc' },
      include: { createdByAdmin: true },
    });
  }

  async findByName(name: string) {
    return this.prisma.subscription.findFirst({
      where: { name, isActive: true },
    });
  }

  async findById(id: string) {
    return this.prisma.subscription.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async update(id: string, data: Prisma.SubscriptionUncheckedUpdateInput) {
    return this.prisma.subscription.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async delete(id: string) {
    return this.prisma.subscription.delete({ where: { id } });
  }

  async hasCompanies(id: string): Promise<boolean> {
    const count = await this.prisma.companySubscription.count({
      where: { subscriptionId: id, isCurrent: true },
    });
    return count > 0;
  }

  /** Resuelve el PlatformAdmin (PK) a partir del userId de Supabase. */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }
}
