import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class BureauCheckRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.CreditStudyUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    return (tx ?? this.prisma).creditStudy.create({ data });
  }

  /**
   * Consulta con todo lo que necesitan detail/perform/pdf: identidad del
   * titular, su último snapshot de la central (insumo interno del análisis —
   * NUNCA viaja crudo al front) y el análisis persistido si existe.
   */
  async findWithSnapshot(id: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        companyId: true,
        studyDate: true,
        requestedCreditLine: true,
        studyType: { select: { id: true, code: true, label: true } },
        status: {
          select: {
            id: true,
            type: true,
            code: true,
            label: true,
            parentId: true,
            isActive: true,
          },
        },
        customer: {
          select: {
            id: true,
            businessName: true,
            identificationNumber: true,
            verificationDigit: true,
            personType: { select: { id: true, code: true, label: true } },
            identificationType: { select: { code: true, label: true } },
            nationality: true,
            firstName: true,
            secondName: true,
            firstLastName: true,
            secondLastName: true,
            email: true,
            phone: true,
            address: true,
            birthDate: true,
            birthCity: true,
            gender: true,
            ageRange: true,
            documentStatus: true,
            lastConsultedAt: true,
            daneCity: {
              select: { name: true, region: { select: { name: true } } },
            },
            bureauCity: true,
            riskSnapshots: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                createdAt: true,
                score: true,
                viabilidad: true,
                viabilidadLabel: true,
                ratingRecaudos: true,
                ratingRecaudosLabel: true,
                montoSugerido: true,
                saldoActual: true,
                porcentajeDeuda: true,
                saldoMora: true,
                hasAlertas: true,
                reportedIncome: true,
                quotaToIncomePct: true,
                txtProbabilidad: true,
                txtRecaudos: true,
                paymentBehavior: true,
                creditSectors: true,
                alerts: true,
                suggestions: true,
                balanceEvolution: true,
              },
            },
          },
        },
        bureauCheckAnalysis: true,
      },
    });
  }

  async updateStatus(id: string, statusId: number, userId: string) {
    return this.prisma.creditStudy.update({
      where: { id },
      data: { statusId, updatedBy: userId },
    });
  }

  /** El análisis es 1:1 con la consulta; re-perform lo reemplaza (upsert). */
  async upsertAnalysis(params: {
    creditStudyId: string;
    companyId: string;
    createdBy: string;
    summary: string;
    riskLevel: string;
    redFlags: Prisma.InputJsonValue;
    positiveSignals: Prisma.InputJsonValue;
    sections: Prisma.InputJsonValue;
    keyFigures: Prisma.InputJsonValue;
    amountComparison: Prisma.InputJsonValue;
    recommendations: Prisma.InputJsonValue;
    aiAnalysisId: string | null;
  }) {
    const { creditStudyId, ...rest } = params;
    return this.prisma.bureauCheckAnalysis.upsert({
      where: { creditStudyId },
      create: { creditStudyId, ...rest },
      update: rest,
    });
  }

  /** Encabezado de la empresa para el informe PDF. */
  async findCompanyHeader(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, daneCity: { select: { name: true } } },
    });
  }
}
