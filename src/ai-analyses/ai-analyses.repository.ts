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

  async findCreditStudyWithCustomer(creditStudyId: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id: creditStudyId, companyId },
      include: {
        customer: true,
        status: true,
      },
    });
  }

  /**
   * Carga completa para el análisis IA (modelo v2): el estudio + su cliente (con
   * tipo de persona legible), los análisis financieros congelados (PDF y/o
   * DataCrédito, cada uno con sus 2 años y sus indicadores) y el último snapshot
   * de riesgo de la central. El `viabilityConditions` ya vive en el estudio
   * (ScoringResult persistido por performStudy). Devuelve null si no existe.
   */
  async findStudyForAiAnalysis(creditStudyId: string, companyId: string) {
    const study = await this.prisma.creditStudy.findFirst({
      where: { id: creditStudyId, companyId },
      include: {
        customer: {
          include: {
            personType: {
              select: { id: true, code: true, label: true, description: true },
            },
            daneCity: { select: { name: true } },
          },
        },
        status: true,
        // El branch de la narrativa depende del tipo de estudio.
        studyType: { select: { code: true } },
        employmentType: { select: { code: true, label: true } },
      },
    });
    if (!study) return null;

    const [frozen, riskSnapshot, capacityAnalysis] = await Promise.all([
      this.prisma.creditStudyFinancialAnalysis.findMany({
        where: { creditStudyId },
        orderBy: { createdAt: 'asc' },
        select: {
          financialAnalysis: {
            include: {
              periods: { orderBy: { fiscalYear: 'desc' }, take: 2 },
            },
          },
        },
      }),
      this.prisma.customerRiskSnapshot.findFirst({
        where: { customerId: study.customerId },
        orderBy: { createdAt: 'desc' },
      }),
      // Solo existe en estudios de capacidad (1:1); null en EEFF.
      this.prisma.paymentCapacityAnalysis.findUnique({
        where: { creditStudyId },
      }),
    ]);

    const analyses = frozen.map((r) => r.financialAnalysis);
    return { study, analyses, riskSnapshot, capacityAnalysis };
  }
}
