import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PaymentCapacityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert del análisis de capacidad (1:1 con el estudio): cada perform
   * recalcula y PISA el anterior — igual que el resultado congelado del
   * estudio, la última corrida es la vigente.
   */
  async upsertAnalysis(
    creditStudyId: string,
    data: Omit<
      Prisma.PaymentCapacityAnalysisUncheckedCreateInput,
      'id' | 'creditStudyId'
    >,
  ) {
    return this.prisma.paymentCapacityAnalysis.upsert({
      where: { creditStudyId },
      create: { creditStudyId, ...data },
      update: data,
    });
  }

  async findAnalysisByStudy(creditStudyId: string) {
    return this.prisma.paymentCapacityAnalysis.findUnique({
      where: { creditStudyId },
    });
  }

  async deleteAnalysis(creditStudyId: string) {
    return this.prisma.paymentCapacityAnalysis.deleteMany({
      where: { creditStudyId },
    });
  }

  /** Persistencia del resultado del perform sobre el estudio (misma forma que
   *  el update del flujo EEFF: include customer+status para buildStep3). */
  async updateStudy(id: string, data: Prisma.CreditStudyUncheckedUpdateInput) {
    return this.prisma.creditStudy.update({
      where: { id },
      data,
      include: { customer: true, status: true },
    });
  }
}
