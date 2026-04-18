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
    campaign: true,
  };

  async create(data: Prisma.CompanySubscriptionUncheckedCreateInput) {
    return this.prisma.companySubscription.create({
      data,
      include: this.defaultInclude,
    });
  }

  async update(
    id: string,
    data: Prisma.CompanySubscriptionUncheckedUpdateInput,
  ) {
    return this.prisma.companySubscription.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async companyExists(companyId: string): Promise<boolean> {
    const count = await this.prisma.company.count({ where: { id: companyId } });
    return count > 0;
  }

  async findSubscriptionById(subscriptionId: string) {
    return this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
  }

  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findUnique({
      where: { type_code: { type, code } },
    });
  }

  async findActiveSubscriptionByCompanyId(
    companyId: string,
    activeStatusId: number,
  ) {
    return this.prisma.companySubscription.findFirst({
      where: { companyId, statusId: activeStatusId },
      include: this.defaultInclude,
    });
  }

  async findPendingByCompanyId(companyId: string, pendingStatusId: number) {
    return this.prisma.companySubscription.findFirst({
      where: { companyId, statusId: pendingStatusId },
      orderBy: { createdAt: 'desc' },
      include: this.defaultInclude,
    });
  }

  async findByIdGlobal(id: string) {
    return this.prisma.companySubscription.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async findCompanyById(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      include: { billingDocType: true },
    });
  }

  async updateCompanyBilling(
    companyId: string,
    data: {
      billingName: string;
      billingLastName: string;
      billingDocNumber: string;
      billingEmail: string;
      billingAddress: string;
      billingState: string;
      billingCity: string;
      billingPhone: string;
      billingDocTypeId: number;
    },
  ) {
    return this.prisma.company.update({
      where: { id: companyId },
      data,
    });
  }

  async findActiveByBillingDoc(billingDocNumber: string) {
    return this.prisma.companySubscription.findFirst({
      where: {
        isCurrent: true,
        autoRenew: true,
        company: { billingDocNumber },
      },
      include: this.defaultInclude,
    });
  }

  // ─── PaymentHistory ─────────────────────────────────────────

  async createPaymentHistory(data: Prisma.PaymentHistoryUncheckedCreateInput) {
    return this.prisma.paymentHistory.create({ data });
  }

  async paymentExistsByTransactionId(epaycoTransactionId: string) {
    const count = await this.prisma.paymentHistory.count({
      where: { epaycoTransactionId },
    });
    return count > 0;
  }
}
