import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class FinancialStatementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Estudio + customer, acotado a la empresa. Para validar pertenencia. */
  async findCreditStudy(creditStudyId: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id: creditStudyId, companyId },
      select: {
        id: true,
        companyId: true,
        customerId: true,
        statusId: true,
        status: { select: { id: true, code: true } },
        customer: { select: { id: true, businessName: true } },
      },
    });
  }

  /** Cambia el estado del estudio (p. ej. tras cargar los EEFF). */
  async updateStudyStatus(creditStudyId: string, statusId: number) {
    return this.prisma.creditStudy.update({
      where: { id: creditStudyId },
      data: { statusId },
    });
  }

  /**
   * Persiste, en UNA transacción, un análisis financiero completo:
   *  - el análisis con sus indicadores,
   *  - N períodos crudos (todos los años que trajo la extracción), colgados del
   *    análisis vía analysisId,
   *  - la fila de la join que lo congela contra el estudio.
   * El corriente/anterior para los indicadores NO se marca en el modelo: se
   * resuelve por fiscalYear DESC al leer (los 2 más recientes). Devuelve el
   * análisis creado con sus períodos.
   */
  async persistAnalysis(params: {
    companyId: string;
    customerId: string;
    createdBy: string;
    creditStudyId: string;
    source: string;
    // Un período por año, en cualquier orden (se ordenan al leer). Sin analysisId:
    // se inyecta al crearlos dentro de la transacción.
    periods: Array<
      Omit<Prisma.FinancialStatementPeriodUncheckedCreateInput, 'analysisId'>
    >;
    indicators: Omit<
      Prisma.FinancialAnalysisUncheckedCreateInput,
      'customerId' | 'companyId' | 'createdBy' | 'source'
    >;
  }) {
    const {
      companyId,
      customerId,
      createdBy,
      creditStudyId,
      source,
      periods,
      indicators,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      const analysis = await tx.financialAnalysis.create({
        data: {
          ...indicators,
          companyId,
          customerId,
          createdBy,
          source,
        },
      });

      for (const period of periods) {
        await tx.financialStatementPeriod.create({
          data: { ...period, analysisId: analysis.id },
        });
      }

      await tx.creditStudyFinancialAnalysis.create({
        data: { creditStudyId, financialAnalysisId: analysis.id },
      });

      return tx.financialAnalysis.findUniqueOrThrow({
        where: { id: analysis.id },
        include: { periods: { orderBy: { fiscalYear: 'desc' } } },
      });
    });
  }

  /**
   * Última consulta al bureau del cliente que trajo estados financieros. Se usa
   * para poblar el análisis source='datacredito' al subir el PDF. Devuelve el
   * rawResponse (JSON crudo de MiDecisor) y el id de la consulta (para trazar los
   * períodos a su origen). null si el cliente no tiene consultas.
   */
  async findLastConsultationRaw(customerId: string) {
    return this.prisma.creditBureauConsultation.findFirst({
      where: { customerId },
      orderBy: { consultaAt: 'desc' },
      select: { id: true, rawResponse: true },
    });
  }

  /** Análisis financieros congelados por un estudio (vía la join). */
  async findAnalysesByCreditStudy(creditStudyId: string) {
    return this.prisma.financialAnalysis.findMany({
      where: { creditStudies: { some: { creditStudyId } } },
      include: { periods: { orderBy: { fiscalYear: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
