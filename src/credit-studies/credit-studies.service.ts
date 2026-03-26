import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreditStudiesRepository } from './credit-studies.repository.js';
import { CreateCreditStudyDto } from './dto/create-credit-study.dto.js';
import { UpdateCreditStudyDto } from './dto/update-credit-study.dto.js';
import { FilterCreditStudyDto } from './dto/filter-credit-study.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { getMonthsFromPeriod } from '../common/enums/income-statement-period.enum.js';

@Injectable()
export class CreditStudiesService {
  constructor(
    private readonly repository: CreditStudiesRepository,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  async create(companyId: string, userId: string, dto: CreateCreditStudyDto) {
    const customerBelongs = await this.repository.customerBelongsToCompany(
      dto.customerId,
      companyId,
    );
    if (!customerBelongs) {
      throw new BadRequestException('Customer does not belong to this company');
    }

    const { customerId, studyDate, resolutionDate, ...rest } = dto;

    const newStatus =
      await this.parametersRepository.findByCode('enRevision');

    return this.repository.create({
      ...rest,
      customerId,
      companyId,
      studyDate: new Date(studyDate),
      resolutionDate: resolutionDate ? new Date(resolutionDate) : undefined,
      createdBy: userId,
      updatedBy: userId,
      statusId: newStatus!.id
    });
  }

  async findAll(companyId: string, filters: FilterCreditStudyDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CreditStudyWhereInput = { companyId };

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters.statusId) {
      where.statusId = filters.statusId;
    }

    if (filters.studyDateFrom || filters.studyDateTo) {
      where.studyDate = {};
      if (filters.studyDateFrom) {
        where.studyDate.gte = new Date(filters.studyDateFrom);
      }
      if (filters.studyDateTo) {
        where.studyDate.lte = new Date(filters.studyDateTo);
      }
    }

    if (filters.search) {
      where.customer = {
        OR: [
          { businessName: { contains: filters.search, mode: 'insensitive' } },
          {
            identificationNumber: {
              contains: filters.search,
              mode: 'insensitive',
            },
          },
        ],
      };
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { studyDate: 'desc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, companyId: string) {
    const study = await this.repository.findById(id, companyId);
    if (!study) {
      throw new NotFoundException(
        `Credit study with id=${id} not found in this company`,
      );
    }
    return study;
  }

  async update(
    id: string,
    companyId: string,
    userId: string,
    dto: UpdateCreditStudyDto,
  ) {
    const current = await this.repository.findById(id, companyId);
    if (!current) {
      throw new NotFoundException(
        `Credit study with id=${id} not found in this company`,
      );
    }

    if (dto.customerId && dto.customerId !== current.customerId) {
      const customerBelongs = await this.repository.customerBelongsToCompany(
        dto.customerId,
        companyId,
      );
      if (!customerBelongs) {
        throw new BadRequestException(
          'Customer does not belong to this company',
        );
      }
    }

    const { customerId, studyDate, resolutionDate, ...rest } = dto;

    return this.repository.update(id, {
      ...rest,
      studyDate: studyDate ? new Date(studyDate) : undefined,
      resolutionDate: resolutionDate ? new Date(resolutionDate) : undefined,
      updatedBy: userId,
    });
  }

  async remove(id: string, companyId: string) {
    const study = await this.repository.findById(id, companyId);
    if (!study) {
      throw new NotFoundException(
        `Credit study with id=${id} not found in this company`,
      );
    }

    return this.repository.delete(id);
  }

  async getCreditStudyPerform(id: string, companyId: string, userId: string) {
    const study = await this.repository.findById(id, companyId);
    if (!study) {
      throw new NotFoundException(
        `Credit study with id=${id} not found in this company`,
      );
    }

    //parameters
    const period = await this.parametersRepository.findById(
      study.incomeStatementId!,
    );

    const periodMonths = getMonthsFromPeriod(period?.label ?? 'Anual');

    // calculos
    const totalAssets = study.totalAssets ?? 1;
    const x1 =
      ((study.totalCurrentAssets ?? 0) - (study.totalCurrentLiabilities ?? 0)) /
      totalAssets;
    const x2 = (study.retainedEarnings ?? 0) / totalAssets;
    const x3 =
      ((study.grossProfit ?? 0) +
        (study.administrativeExpenses ?? 0) +
        (study.sellingExpenses ?? 0)) /
      totalAssets;
    const x4 = (study.equity ?? 0) / (study.totalLiabilities ?? 1);
    const x5 = (study.ordinaryActivityRevenue ?? 0) / totalAssets;

    const result = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + x5;

    const stabilityFactor =
      result <= 1.8 ? 0.33 : result >= 1.8 && result <= 3 ? 0.66 : 1;
    const ebitda =
      (study.ordinaryActivityRevenue ?? 0) -
      (study.costOfSales ?? 0) -
      (study.administrativeExpenses ?? 0) -
      (study.sellingExpenses ?? 0) -
      (study.depreciation ?? 0) -
      (study.amortization ?? 0);
    const adjustedEbitda = ebitda * stabilityFactor;
    const currentDebtSevice =
      (study.shortTermFinancialLiabilities ?? 0) +
      (study.financialExpenses ?? 0);
    const annualPaymentCapacity = adjustedEbitda - currentDebtSevice;

    const monthlyPaymentCapacity = Math.round(
      annualPaymentCapacity / periodMonths,
    );

    const averagePaymentTime = Math.round(
      (((study.suppliers1 ?? 0) + (study.suppliers2 ?? 0)) /
        2 /
        ((study.costOfSales ?? 0) +
          (study.inventories2 ?? 0) -
          (study.inventories1 ?? 0))) *
        365,
    );

    const accountsReceivableTurnover = Math.round(
      (((study.accountsReceivable1 ?? 0) + (study.accountsReceivable2 ?? 0)) /
        2 /
        (study.ordinaryActivityRevenue ?? 1)) *
        365,
    );

    const inventoryTurnover = Math.round(
      (((study.inventories1 ?? 0) + (study.inventories2 ?? 0)) /
        2 /
        (study.costOfSales ?? 1)) *
        365,
    );

    const suppliersTurnover = -averagePaymentTime;

    const maximumPaymentTime =
      accountsReceivableTurnover + inventoryTurnover + suppliersTurnover;

    // ── Viabilidad ──────────────────────────────────────────
    const zScore = result;
    const alerts: Array<{ type: string; dimension: string; message: string }> = [];
    const dimensions: Record<string, any> = {};

    // Dimension 1: Salud financiera
    if (zScore > 3.0) {
      dimensions.financialHealth = { score: 25, maxScore: 25, status: 'healthy', label: 'Salud Financiera' };
      alerts.push({ type: 'success', dimension: 'financialHealth', message: 'La empresa presenta indicadores financieros solidos con baja probabilidad de riesgo.' });
    } else if (zScore > 1.8) {
      dimensions.financialHealth = { score: 12, maxScore: 25, status: 'gray_zone', label: 'Salud Financiera' };
      alerts.push({ type: 'warning', dimension: 'financialHealth', message: 'La empresa se encuentra en zona de observacion. Se recomienda monitoreo periodico de sus estados financieros.' });
    } else {
      dimensions.financialHealth = { score: 0, maxScore: 25, status: 'critical', label: 'Salud Financiera' };
      alerts.push({ type: 'danger', dimension: 'financialHealth', message: 'La empresa presenta indicadores financieros criticos con alta probabilidad de incumplimiento.' });
    }

    // Dimension 2: Capacidad de pago
    const requestedMonthly = study.requestedMonthlyCreditLine ?? 0;
    const paymentRatio = requestedMonthly > 0 ? monthlyPaymentCapacity / requestedMonthly : 0;
    const marginPercent = Math.round((paymentRatio - 1) * 1000) / 10;

    if (monthlyPaymentCapacity <= 0) {
      dimensions.paymentCapacity = { score: 0, maxScore: 25, status: 'insufficient', ratio: paymentRatio, marginPercent: 0, label: 'Capacidad de Pago' };
      alerts.push({ type: 'danger', dimension: 'paymentCapacity', message: `El cliente no cuenta con capacidad de pago. El servicio de deuda actual ($${currentDebtSevice.toLocaleString('es-CO')}) supera el EBITDA ajustado.` });
    } else if (paymentRatio >= 1.2) {
      dimensions.paymentCapacity = { score: 25, maxScore: 25, status: 'comfortable', ratio: paymentRatio, marginPercent, label: 'Capacidad de Pago' };
      alerts.push({ type: 'success', dimension: 'paymentCapacity', message: `La capacidad de pago mensual ($${monthlyPaymentCapacity.toLocaleString('es-CO')}) supera ampliamente el cupo solicitado ($${requestedMonthly.toLocaleString('es-CO')}) con un margen del ${marginPercent}%.` });
    } else if (paymentRatio >= 1.0) {
      dimensions.paymentCapacity = { score: 15, maxScore: 25, status: 'tight', ratio: paymentRatio, marginPercent, label: 'Capacidad de Pago' };
      alerts.push({ type: 'warning', dimension: 'paymentCapacity', message: `La capacidad de pago mensual ($${monthlyPaymentCapacity.toLocaleString('es-CO')}) cubre el cupo solicitado ($${requestedMonthly.toLocaleString('es-CO')}) con un margen ajustado del ${marginPercent}%. Se recomienda no incrementar el cupo.` });
    } else {
      const deficit = Math.round((1 - paymentRatio) * 1000) / 10;
      dimensions.paymentCapacity = { score: 0, maxScore: 25, status: 'insufficient', ratio: paymentRatio, marginPercent: -deficit, label: 'Capacidad de Pago' };
      alerts.push({ type: 'danger', dimension: 'paymentCapacity', message: `La capacidad de pago mensual ($${monthlyPaymentCapacity.toLocaleString('es-CO')}) es insuficiente para cubrir el cupo solicitado ($${requestedMonthly.toLocaleString('es-CO')}). Deficit del ${deficit}%.` });
    }

    // Determinar si la capacidad de pago es inviable (eliminatorio)
    const isPaymentInviable = monthlyPaymentCapacity <= 0 || paymentRatio < 1.0;

    // Dimension 3: Coherencia de plazos
    const requestedTerm = study.requestedTerm ?? 0;
    let realTerm = maximumPaymentTime;
    if (maximumPaymentTime <= 0) {
      realTerm = accountsReceivableTurnover;
      alerts.push({ type: 'info', dimension: 'termCoherence', message: `Los tiempos de rotacion presentan valores atipicos. El analisis de plazos se basa en la rotacion de cartera (${accountsReceivableTurnover} dias) como referencia.` });
    }

    if (isPaymentInviable) {
      // Sin capacidad de pago, la coherencia de plazos no es evaluable favorablemente
      dimensions.termCoherence = { score: 0, maxScore: 25, status: 'not_applicable', requestedTerm, realTerm, label: 'Coherencia de Plazos' };
      alerts.push({ type: 'danger', dimension: 'termCoherence', message: 'La coherencia de plazos no es evaluable dado que no existe capacidad de pago suficiente.' });
    } else if (requestedTerm >= realTerm) {
      dimensions.termCoherence = { score: 25, maxScore: 25, status: 'coherent', requestedTerm, realTerm, label: 'Coherencia de Plazos' };
      alerts.push({ type: 'success', dimension: 'termCoherence', message: `El plazo solicitado (${requestedTerm} dias) es coherente con los tiempos de operacion del cliente.` });
    } else if (requestedTerm >= realTerm * 0.7) {
      dimensions.termCoherence = { score: 12, maxScore: 25, status: 'risky', requestedTerm, realTerm, label: 'Coherencia de Plazos' };
      alerts.push({ type: 'warning', dimension: 'termCoherence', message: `El plazo solicitado (${requestedTerm} dias) es inferior a los tiempos reales de operacion (${realTerm} dias). Se recomienda un plazo de al menos ${realTerm} dias.` });
    } else {
      dimensions.termCoherence = { score: 0, maxScore: 25, status: 'incoherent', requestedTerm, realTerm, label: 'Coherencia de Plazos' };
      alerts.push({ type: 'danger', dimension: 'termCoherence', message: `El plazo solicitado (${requestedTerm} dias) es significativamente inferior a los tiempos reales de operacion (${realTerm} dias). Alto riesgo de incumplimiento en plazos.` });
    }

    // Plazo recomendado
    let recommendedTerm: number;
    if (maximumPaymentTime > 0) {
      recommendedTerm = maximumPaymentTime;
    } else if (accountsReceivableTurnover > 0) {
      recommendedTerm = accountsReceivableTurnover;
    } else {
      recommendedTerm = requestedTerm;
    }

    // Cupo recomendado (solo tiene sentido si hay capacidad de pago positiva)
    const recommendedCreditLine = monthlyPaymentCapacity > 0
      ? Math.round(monthlyPaymentCapacity * (recommendedTerm / 30))
      : 0;

    // Dimension 4: Cupo recomendado vs. solicitado
    if (isPaymentInviable) {
      // Sin capacidad de pago, el cupo no es evaluable favorablemente
      dimensions.creditLineAdequacy = { score: 0, maxScore: 25, status: 'not_applicable', ratio: 0, label: 'Adecuacion del Cupo' };
      alerts.push({ type: 'danger', dimension: 'creditLineAdequacy', message: 'No es posible recomendar un cupo de credito dado que la capacidad de pago es insuficiente.' });
    } else {
      const creditRatio = recommendedCreditLine > 0 ? requestedMonthly / recommendedCreditLine : 0;
      if (creditRatio <= 1.0) {
        dimensions.creditLineAdequacy = { score: 25, maxScore: 25, status: 'adequate', ratio: creditRatio, label: 'Adecuacion del Cupo' };
        alerts.push({ type: 'success', dimension: 'creditLineAdequacy', message: `El cupo solicitado se encuentra dentro del rango recomendado. Cupo maximo sugerido: $${recommendedCreditLine.toLocaleString('es-CO')}.` });
      } else if (creditRatio <= 1.3) {
        const exceso = Math.round((creditRatio - 1) * 1000) / 10;
        dimensions.creditLineAdequacy = { score: 15, maxScore: 25, status: 'slightly_exceeded', ratio: creditRatio, label: 'Adecuacion del Cupo' };
        alerts.push({ type: 'warning', dimension: 'creditLineAdequacy', message: `El cupo solicitado excede en un ${exceso}% el cupo recomendado ($${recommendedCreditLine.toLocaleString('es-CO')}). Se sugiere ajustar a este valor.` });
      } else {
        const exceso = Math.round((creditRatio - 1) * 1000) / 10;
        dimensions.creditLineAdequacy = { score: 0, maxScore: 25, status: 'excessive', ratio: creditRatio, label: 'Adecuacion del Cupo' };
        alerts.push({ type: 'danger', dimension: 'creditLineAdequacy', message: `El cupo solicitado excede significativamente el cupo recomendado ($${recommendedCreditLine.toLocaleString('es-CO')}) en un ${exceso}%. Se recomienda reducirlo.` });
      }
    }

    // Score y status final
    const viabilityScore =
      dimensions.financialHealth.score +
      dimensions.paymentCapacity.score +
      dimensions.termCoherence.score +
      dimensions.creditLineAdequacy.score;

    let viabilityStatus: string;
    if (isPaymentInviable) {
      viabilityStatus = 'rejected';
    } else if (viabilityScore >= 75) {
      viabilityStatus = 'approved';
    } else if (viabilityScore >= 40) {
      viabilityStatus = 'conditional';
    } else {
      viabilityStatus = 'rejected';
    }

    // Alertas cross-dimension
    if (viabilityStatus === 'conditional') {
      alerts.push({ type: 'info', dimension: 'general', message: 'El estudio es aprobable sujeto a las condiciones indicadas. Revise las recomendaciones de plazo y cupo.' });
    }

    if (viabilityStatus === 'rejected' && !isPaymentInviable && dimensions.termCoherence.score === 0) {
      alerts.push({ type: 'info', dimension: 'general', message: `El cliente podria ser viable con un plazo de ${recommendedTerm} dias en lugar de ${requestedTerm} dias.` });
    }

    if (annualPaymentCapacity < requestedMonthly * 12) {
      alerts.push({ type: 'warning', dimension: 'general', message: `La capacidad de pago anual ($${Math.round(annualPaymentCapacity).toLocaleString('es-CO')}) no cubre 12 meses del cupo solicitado. Considerar un cupo menor o un plazo mas corto.` });
    }

    if (inventoryTurnover === 0) {
      alerts.push({ type: 'info', dimension: 'general', message: 'No se registra rotacion de inventarios. Verifique si el tipo de negocio del cliente aplica para este indicador.' });
    }

    const viabilityConditions = {
      dimensions,
      alerts,
      summary: {
        totalScore: viabilityScore,
        maxScore: 100,
        status: viabilityStatus,
        recommendedTerm,
        recommendedCreditLine,
        monthlyPaymentCapacity,
        annualPaymentCapacity: Math.round(annualPaymentCapacity),
      },
    };

    const newStatus =
      await this.parametersRepository.findByCode('estudioRealizado');

    return this.repository.update(id, {
      ebitda,
      adjustedEbitda,
      currentDebtService: currentDebtSevice,
      annualPaymentCapacity,
      monthlyPaymentCapacity,
      accountsReceivableTurnover,
      inventoryTurnover,
      suppliersTurnover,
      maximumPaymentTime,
      stabilityFactor,
      updatedBy: userId,
      averagePaymentTime,
      recommendedTerm,
      recommendedCreditLine,
      viabilityScore,
      viabilityStatus,
      viabilityConditions,
      statusId: newStatus?.id,
      resolutionDate: new Date(),
    });
  }
}
