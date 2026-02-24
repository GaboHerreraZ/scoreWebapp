import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CompanySubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    subscription: true,
    status: true,
    company: true,
  };

  async create(data: Prisma.CompanySubscriptionUncheckedCreateInput) {
    return this.prisma.companySubscription.create({
      data,
      include: this.defaultInclude,
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.CompanySubscriptionWhereInput;
    orderBy?: Prisma.CompanySubscriptionOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.companySubscription.findMany({
        skip,
        take,
        where,
        orderBy,
        include: this.defaultInclude,
      }),
      this.prisma.companySubscription.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.companySubscription.findFirst({
      where: { id, companyId },
      include: this.defaultInclude,
    });
  }

  async findCurrentByCompanyId(companyId: string) {
    return this.prisma.companySubscription.findFirst({
      where: { companyId, isCurrent: true },
      include: this.defaultInclude,
    });
  }

  async update(id: string, data: Prisma.CompanySubscriptionUncheckedUpdateInput) {
    return this.prisma.companySubscription.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async delete(id: string) {
    return this.prisma.companySubscription.delete({ where: { id } });
  }

  async deactivateCurrentSubscription(companyId: string, upgradedStatusId: number) {
    return this.prisma.companySubscription.updateMany({
      where: { companyId, isCurrent: true },
      data: { isCurrent: false, statusId: upgradedStatusId },
    });
  }

  async companyExists(companyId: string): Promise<boolean> {
    const count = await this.prisma.company.count({ where: { id: companyId } });
    return count > 0;
  }

  async subscriptionExists(subscriptionId: string): Promise<boolean> {
    const count = await this.prisma.subscription.count({
      where: { id: subscriptionId },
    });
    return count > 0;
  }

  async findSubscriptionById(subscriptionId: string) {
    return this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
  }

  async parameterExists(parameterId: number): Promise<boolean> {
    const count = await this.prisma.parameter.count({
      where: { id: parameterId },
    });
    return count > 0;
  }

  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findUnique({
      where: { type_code: { type, code } },
    });
  }

  async findActiveSubscriptionByCompanyId(companyId: string, activeStatusId: number) {
    return this.prisma.companySubscription.findFirst({
      where: { companyId, statusId: activeStatusId },
      include: this.defaultInclude,
    });
  }

  async findByPaymentId(paymentId: string) {
    return this.prisma.companySubscription.findFirst({
      where: { paymentId },
      include: this.defaultInclude,
    });
  }
}
