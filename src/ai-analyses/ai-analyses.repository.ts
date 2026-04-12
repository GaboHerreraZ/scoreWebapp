import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class AiAnalysesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly detailSelect = {
    id: true,
    result: true,
    status: true,
    durationMs: true,
    companyId: true,
    customerId: true,
    creditStudyId: true,
    typeId: true,
    performedBy: true,
    createdAt: true,
    errorMessage: true,
    type: { select: { id: true, code: true, label: true } },
    customer: { select: { id: true, businessName: true } },
    creditStudy: {
      select: { id: true, viabilityScore: true, viabilityStatus: true },
    },
    performedByUser: {
      select: { id: true, name: true, lastName: true, email: true },
    },
  } as const;

  async create(data: Prisma.AiAnalysisUncheckedCreateInput) {
    return this.prisma.aiAnalysis.create({
      data,
      select: this.detailSelect,
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.AiAnalysisWhereInput;
    orderBy?: Prisma.AiAnalysisOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.aiAnalysis.findMany({
        skip,
        take,
        where,
        orderBy,
        select: {
          id: true,
          creditStudyId: true,
          typeId: true,
          model: true,
          totalTokens: true,
          estimatedCostUsd: true,
          durationMs: true,
          status: true,
          createdAt: true,
          type: { select: { id: true, code: true, label: true } },
          customer: { select: { id: true, businessName: true } },
          performedByUser: { select: { id: true, name: true, lastName: true } },
        },
      }),
      this.prisma.aiAnalysis.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.aiAnalysis.findFirst({
      where: { id, companyId },
      select: this.detailSelect,
    });
  }

  async findByIdWithPdf(id: string, companyId: string) {
    return this.prisma.aiAnalysis.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        pdfFile: true,
      },
    });
  }

  async countThisMonth(companyId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return this.prisma.aiAnalysis.count({
      where: {
        companyId,
        status: 'success',
        createdAt: { gte: startOfMonth },
      },
    });
  }

  async countThisMonthByType(
    companyId: string,
    typeId: number,
  ): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return this.prisma.aiAnalysis.count({
      where: {
        companyId,
        typeId,
        status: 'success',
        createdAt: { gte: startOfMonth },
      },
    });
  }

  async findCurrentSubscription(companyId: string) {
    return this.prisma.companySubscription.findFirst({
      where: { companyId, isCurrent: true },
      include: { subscription: true },
    });
  }

  async findCreditStudyWithCustomer(creditStudyId: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id: creditStudyId, companyId },
      include: {
        customer: true,
        status: true,
      },
    });
  }
}
