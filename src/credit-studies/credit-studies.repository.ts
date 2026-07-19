import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CreditStudiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.CreditStudyUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.creditStudy.create({
      data,
      include: { customer: true, status: true },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.CreditStudyWhereInput;
    orderBy?: Prisma.CreditStudyOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.creditStudy.findMany({
        skip,
        take,
        where,
        orderBy,
        select: {
          id: true,
          resolutionDate: true,
          createdBy: true,
          requestedTerm: true,
          studyDate: true,
          requestedCreditLine: true,
          customer: {
            select: {
              id: true,
              businessName: true,
            },
          },
          status: {
            select: {
              id: true,
              label: true,
            },
          },
        },
      }),
      this.prisma.creditStudy.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id, companyId },
      include: {
        customer: {
          select: {
            id: true,
            businessName: true,
          },
        },
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        status: {
          select: {
            id: true,
            label: true,
            code: true,
          },
        },
        aiAnalyses: {
          select: {
            id: true,
            result: true,
            status: true,
            createdAt: true,
            type: { select: { code: true } },
            performedByUser: {
              select: { id: true, name: true, lastName: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        promissoryNotes: {
          select: {
            id: true,
            amount: true,
            amountInWords: true,
            signingUrl: true,
            signedDocumentUrl: true,
            signedFileStoragePath: true,
            sentAt: true,
            signedAt: true,
            declinedAt: true,
            createdAt: true,
            status: {
              select: { id: true, label: true, code: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  /**
   * Datos para armar el stepper del front. Trae el estudio con:
   *  - customer: identidad + perfil de bureau (bureauProfile) para el step1.
   *  - status: el estado del estudio, para el nivel raíz de la respuesta.
   * Acotado a la empresa (pertenencia). null si no existe.
   */
  async findStepsData(id: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        studyDate: true,
        requestedTerm: true,
        requestedCreditLine: true,
        recommendedTerm: true,
        recommendedCreditLine: true,
        viabilityScore: true,
        viabilityStatus: true,
        viabilityConditions: true,
        resolutionDate: true,
        customer: {
          select: {
            id: true,
            companyId: true,
            personTypeId: true,
            identificationTypeId: true,
            businessName: true,
            identificationNumber: true,
            verificationDigit: true,
            personType: {
              select: { id: true, code: true, label: true },
            },
            firstName: true,
            secondName: true,
            firstLastName: true,
            secondLastName: true,
            email: true,
            phone: true,
            city: true,
            state: true,
            address: true,
            birthDate: true,
            birthCity: true,
            gender: true,
            ageRange: true,
            documentStatus: true,
            bureauProfile: true,
            bureauCreated: true,
            lastConsultedAt: true,
            // Último snapshot de riesgo de la central (para el bloque centralRisk
            // del step1). Trae los escalares + labels + los bloques JSON (cartera,
            // comportamiento, sectores, malla de vínculos). PN llena income; PJ
            // llena nivel/rating/cartera/malla. El servicio lo transforma y NO lo
            // devuelve crudo dentro de customer.
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
                nivelRiesgo: true,
                nivelRiesgoLabel: true,
                ratingSectorial: true,
                ratingSectorialLabel: true,
                montoSugerido: true,
                saldoActual: true,
                porcentajeDeuda: true,
                saldoMora: true,
                hasAlertas: true,
                reportedIncome: true,
                quotaToIncomePct: true,
                creditPortfolio: true,
                paymentBehavior: true,
                creditSectors: true,
                linkNetwork: true,
                alerts: true,
              },
            },
          },
        },
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
        // Informe IA (creditReview) exitoso más reciente del estudio, si existe.
        // Se expone en el step3 para que el front lo muestre sin otra llamada.
        aiAnalyses: {
          where: { type: { code: 'creditReview' }, status: 'success' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            result: true,
            model: true,
            createdAt: true,
            performedBy: true,
          },
        },
      },
    });
  }

  /**
   * Datos necesarios para REALIZAR el análisis de viabilidad de un estudio:
   *  - el estudio con su solicitud (cupo/plazo) y customerId,
   *  - los análisis financieros congelados (pdf_upload / datacredito) con sus
   *    períodos (2 más recientes),
   *  - el último snapshot de riesgo de la central del cliente (nivel, sector,
   *    score, montoSugerido, comportamiento de pago para detectar mora),
   *  - la configuración de scoring vigente de la empresa.
   * Todo acotado a la empresa. null si el estudio no existe.
   */
  async findAnalysisInputs(creditStudyId: string, companyId: string) {
    const study = await this.prisma.creditStudy.findFirst({
      where: { id: creditStudyId, companyId },
      select: {
        id: true,
        companyId: true,
        customerId: true,
        requestedTerm: true,
        requestedCreditLine: true,
        status: { select: { code: true } },
        customer: {
          select: {
            personTypeId: true,
            personType: { select: { code: true } },
            // Perfil de bureau: trae registration.status (matrícula) e
            // inLiquidation, señales legales que pueden ser eliminatorias.
            bureauProfile: true,
          },
        },
      },
    });
    if (!study) return null;

    const [analyses, riskSnapshot, scoringConfig] = await Promise.all([
      this.findFrozenAnalyses(creditStudyId),
      this.prisma.customerRiskSnapshot.findFirst({
        where: { customerId: study.customerId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.scoringConfiguration.findFirst({
        where: {
          companyId,
          personTypeId: study.customer.personTypeId,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          weights: {
            include: { dimension: { select: { code: true, label: true } } },
          },
        },
      }),
    ]);

    return { study, analyses, riskSnapshot, scoringConfig };
  }

  /**
   * Análisis financieros congelados en un estudio (vía la join), con sus períodos
   * (2 más recientes por análisis, fiscalYear DESC) e indicadores/ratios. Alimenta
   * el step2 del stepper: una "fuente" por análisis (pdf_upload / datacredito).
   */
  async findFrozenAnalyses(creditStudyId: string) {
    const rows = await this.prisma.creditStudyFinancialAnalysis.findMany({
      where: { creditStudyId },
      orderBy: { createdAt: 'asc' },
      select: {
        financialAnalysis: {
          include: {
            periods: {
              orderBy: { fiscalYear: 'desc' },
              take: 2,
            },
          },
        },
      },
    });
    return rows.map((r) => r.financialAnalysis);
  }

  async update(id: string, data: Prisma.CreditStudyUncheckedUpdateInput) {
    return this.prisma.creditStudy.update({
      where: { id },
      data,
      include: { customer: true, status: true },
    });
  }

  async delete(id: string) {
    return this.prisma.creditStudy.delete({ where: { id } });
  }

  async findAllForExport(companyId: string) {
    return this.prisma.creditStudy.findMany({
      where: { companyId },
      orderBy: { studyDate: 'desc' },
      include: {
        customer: {
          select: { id: true, businessName: true, identificationNumber: true },
        },
        status: { select: { id: true, label: true, code: true } },
      },
    });
  }

  /** Datos de la empresa para el encabezado del PDF (nombre, NIT, ciudad). */
  async findCompanyHeader(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, city: true },
    });
  }

  async customerBelongsToCompany(
    customerId: string,
    companyId: string,
  ): Promise<boolean> {
    const count = await this.prisma.customer.count({
      where: { id: customerId, companyId },
    });
    return count > 0;
  }
}
