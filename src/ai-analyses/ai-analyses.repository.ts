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

  /**
   * Vincula una fila de AiAnalysis (p. ej. la extracción de PDF, creada antes
   * que el estudio) a su CreditStudy. Acepta un tx opcional para correr dentro
   * de la transacción que crea el estudio. updateMany para no fallar si el id no
   * existe (best-effort).
   */
  async linkToCreditStudy(
    analysisId: string,
    creditStudyId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.aiAnalysis.updateMany({
      where: { id: analysisId },
      data: { creditStudyId },
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
