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
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class CreditStudiesService {
  constructor(
    private readonly repository: CreditStudiesRepository,
    private readonly parametersRepository: ParametersRepository,
    private readonly notificationsService: NotificationsService,
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

    const newStatus = await this.parametersRepository.findByCode('enRevision');

    return this.repository.create({
      ...rest,
      customerId,
      companyId,
      studyDate: new Date(studyDate),
      resolutionDate: resolutionDate ? new Date(resolutionDate) : undefined,
      createdBy: userId,
      updatedBy: userId,
      statusId: newStatus!.id,
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

    if (current.status?.code === 'estudioCompletado') {
      throw new BadRequestException(
        'No se puede modificar un estudio de crédito que ya fue completado.',
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

    if (study.status?.code === 'estudioCompletado') {
      throw new BadRequestException(
        'No se puede eliminar un estudio de crédito que ya fue completado.',
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

    if (study.status?.code === 'estudioCompletado') {
      throw new BadRequestException(
        'No se puede recalcular un estudio de crédito que ya fue completado.',
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
      (study.sellingExpenses ?? 0) +
      (study.depreciation ?? 0) +
      (study.amortization ?? 0);
    const adjustedEbitda = ebitda * stabilityFactor;
    const currentDebtSevice =
      (study.shortTermFinancialLiabilities ?? 0) +
      (study.financialExpenses ?? 0);
    const annualPaymentCapacity = adjustedEbitda - currentDebtSevice;

    const monthlyPaymentCapacity = Math.round(
      annualPaymentCapacity / periodMonths,
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


    const accountsPayableTurnover1 = ((study.suppliers1 ?? 0) + (study.suppliers2 ?? 0)) / 2;
    const accountsPayableTurnover2 = ((study.costOfSales ?? 0) + (study.inventories2 ?? 0) + (study.administrativeExpenses ?? 0) + (study.sellingExpenses ?? 0) - (study.inventories1 ?? 0));

    const accountsPayableTurnover = accountsPayableTurnover1 / accountsPayableTurnover2;

    const paymentTimeSuppliers = Math.round(accountsPayableTurnover * 365);

    const suppliersTurnover = -paymentTimeSuppliers;



    // ── Viabilidad ──────────────────────────────────────────
    const zScore = result;
    const alerts: Array<{ type: string; dimension: string; message: string }> =
      [];
    const dimensions: Record<string, any> = {};

    // ── Dimension 1: Salud Financiera (Z-Score de Altman) ──
    if (zScore > 3.0) {
      dimensions.financialHealth = {
        score: 25,
        maxScore: 25,
        status: 'healthy',
        label: 'Salud Financiera',
        reason: 'Los indicadores de liquidez, rentabilidad y apalancamiento situan a la empresa en zona segura.',
      };
      alerts.push({
        type: 'success',
        dimension: 'financialHealth',
        message:
          'La empresa presenta indicadores financieros solidos con baja probabilidad de riesgo.',
      });
    } else if (zScore > 1.8) {
      dimensions.financialHealth = {
        score: 12,
        maxScore: 25,
        status: 'gray_zone',
        label: 'Salud Financiera',
        reason: 'Los indicadores financieros situan a la empresa en zona de observacion. Se penaliza parcialmente la capacidad proyectada.',
      };
      alerts.push({
        type: 'warning',
        dimension: 'financialHealth',
        message:
          'La empresa se encuentra en zona de observacion. Se recomienda monitoreo periodico de sus estados financieros.',
      });
    } else {
      dimensions.financialHealth = {
        score: 0,
        maxScore: 25,
        status: 'critical',
        label: 'Salud Financiera',
        reason: 'Los indicadores financieros muestran alta probabilidad de dificultades. Se reduce significativamente la capacidad proyectada.',
      };
      alerts.push({
        type: 'danger',
        dimension: 'financialHealth',
        message:
          'La empresa presenta indicadores financieros criticos con alta probabilidad de incumplimiento.',
      });
    }

    // ── Dimension 2: Capacidad de Pago ──
    // requestedCreditLine = cupo TOTAL solicitado (no mensual)
    // La obligación mensual = cupo / (plazo en días / 30)
    const requestedCredit = study.requestedCreditLine ?? 0;
    const requestedTerm = study.requestedTerm ?? 0;
    const termInMonths = requestedTerm > 0 ? requestedTerm / 30 : 1;
    const monthlyObligation = requestedCredit / termInMonths;

    const paymentRatio =
      monthlyObligation > 0 ? monthlyPaymentCapacity / monthlyObligation : 0;
    const marginPercent = Math.round((paymentRatio - 1) * 1000) / 10;

    if (monthlyPaymentCapacity <= 0) {
      dimensions.paymentCapacity = {
        score: 0,
        maxScore: 25,
        status: 'insufficient',
        ratio: 0,
        marginPercent: 0,
        monthlyObligation: Math.round(monthlyObligation),
        label: 'Capacidad de Pago',
        reason: 'La empresa no genera flujo libre de efectivo despues de cubrir deudas actuales. El EBITDA ajustado no supera el servicio de deuda.',
      };
      alerts.push({
        type: 'danger',
        dimension: 'paymentCapacity',
        message: `El cliente no cuenta con capacidad de pago. El servicio de deuda actual ($${currentDebtSevice.toLocaleString('es-CO')}) supera el EBITDA ajustado.`,
      });
    } else if (paymentRatio >= 1.2) {
      dimensions.paymentCapacity = {
        score: 25,
        maxScore: 25,
        status: 'comfortable',
        ratio: Math.round(paymentRatio * 1000) / 1000,
        marginPercent,
        monthlyObligation: Math.round(monthlyObligation),
        label: 'Capacidad de Pago',
        reason: `La capacidad de pago mensual supera la cuota estimada con un margen del ${marginPercent}%. Ratio: ${(Math.round(paymentRatio * 1000) / 1000).toFixed(2)}x.`,
      };
      alerts.push({
        type: 'success',
        dimension: 'paymentCapacity',
        message: `La capacidad de pago mensual ($${monthlyPaymentCapacity.toLocaleString('es-CO')}) supera la cuota mensual estimada ($${Math.round(monthlyObligation).toLocaleString('es-CO')}) con un margen del ${marginPercent}%.`,
      });
    } else if (paymentRatio >= 1.0) {
      dimensions.paymentCapacity = {
        score: 15,
        maxScore: 25,
        status: 'tight',
        ratio: Math.round(paymentRatio * 1000) / 1000,
        marginPercent,
        monthlyObligation: Math.round(monthlyObligation),
        label: 'Capacidad de Pago',
        reason: `La capacidad cubre la cuota pero con margen ajustado del ${marginPercent}%. Ratio: ${(Math.round(paymentRatio * 1000) / 1000).toFixed(2)}x. No se recomienda incrementar.`,
      };
      alerts.push({
        type: 'warning',
        dimension: 'paymentCapacity',
        message: `La capacidad de pago mensual ($${monthlyPaymentCapacity.toLocaleString('es-CO')}) cubre la cuota mensual estimada ($${Math.round(monthlyObligation).toLocaleString('es-CO')}) con un margen ajustado del ${marginPercent}%. Se recomienda no incrementar el cupo.`,
      });
    } else {
      const deficit = Math.round((1 - paymentRatio) * 1000) / 10;
      dimensions.paymentCapacity = {
        score: 0,
        maxScore: 25,
        status: 'insufficient',
        ratio: Math.round(paymentRatio * 1000) / 1000,
        marginPercent: -deficit,
        monthlyObligation: Math.round(monthlyObligation),
        label: 'Capacidad de Pago',
        reason: `La cuota mensual estimada ($${Math.round(monthlyObligation).toLocaleString('es-CO')}) supera la capacidad de pago ($${monthlyPaymentCapacity.toLocaleString('es-CO')}). Deficit del ${deficit}%.`,
      };
      alerts.push({
        type: 'danger',
        dimension: 'paymentCapacity',
        message: `La capacidad de pago mensual ($${monthlyPaymentCapacity.toLocaleString('es-CO')}) es insuficiente para cubrir la cuota mensual estimada ($${Math.round(monthlyObligation).toLocaleString('es-CO')}). Deficit del ${deficit}%.`,
      });
    }

    // ── Dimension 3: Coherencia de Plazos ──
    // La referencia principal es la rotación de cartera (días que tarda en cobrar)
    // El tiempo de pago a proveedores es informativo pero no define el plazo
    const realTerm = accountsReceivableTurnover > 0
      ? accountsReceivableTurnover
      : requestedTerm;

    if (accountsReceivableTurnover <= 0) {
      alerts.push({
        type: 'info',
        dimension: 'termCoherence',
        message: `No se pudo calcular la rotacion de cartera. Se usa el plazo solicitado como referencia.`,
      });
    }

    if (paymentTimeSuppliers > 0 && paymentTimeSuppliers > accountsReceivableTurnover) {
      alerts.push({
        type: 'info',
        dimension: 'termCoherence',
        message: `El tiempo de pago a proveedores (${paymentTimeSuppliers} dias) es mayor que la rotacion de cartera (${accountsReceivableTurnover} dias). La empresa paga a proveedores mas lento de lo que cobra a clientes.`,
      });
    }

    if (requestedTerm >= realTerm) {
      dimensions.termCoherence = {
        score: 25,
        maxScore: 25,
        status: 'coherent',
        requestedTerm,
        realTerm,
        label: 'Coherencia de Plazos',
        reason: `El plazo solicitado (${requestedTerm}d) iguala o supera la rotacion de cartera (${realTerm}d). El cliente cobra antes de que venza el credito.`,
      };
      alerts.push({
        type: 'success',
        dimension: 'termCoherence',
        message: `El plazo solicitado (${requestedTerm} dias) es coherente con los tiempos de operacion del cliente (${realTerm} dias).`,
      });
    } else if (requestedTerm >= realTerm * 0.7) {
      dimensions.termCoherence = {
        score: 12,
        maxScore: 25,
        status: 'risky',
        requestedTerm,
        realTerm,
        label: 'Coherencia de Plazos',
        reason: `El plazo solicitado (${requestedTerm}d) es inferior a la rotacion de cartera (${realTerm}d) pero cubre al menos el 70%. Riesgo moderado.`,
      };
      alerts.push({
        type: 'warning',
        dimension: 'termCoherence',
        message: `El plazo solicitado (${requestedTerm} dias) es inferior a los tiempos reales de operacion (${realTerm} dias). Se recomienda un plazo de al menos ${realTerm} dias.`,
      });
    } else {
      dimensions.termCoherence = {
        score: 0,
        maxScore: 25,
        status: 'incoherent',
        requestedTerm,
        realTerm,
        label: 'Coherencia de Plazos',
        reason: `El plazo solicitado (${requestedTerm}d) es menor al 70% de la rotacion de cartera (${realTerm}d). El credito vence antes de que el cliente cobre a sus clientes.`,
      };
      alerts.push({
        type: 'danger',
        dimension: 'termCoherence',
        message: `El plazo solicitado (${requestedTerm} dias) es significativamente inferior a los tiempos reales de operacion (${realTerm} dias). Alto riesgo de incumplimiento en plazos.`,
      });
    }

    // ── Plazo recomendado ──
    // Basado en la rotación de cartera como referencia principal
    let recommendedTerm: number;
    if (accountsReceivableTurnover > 0) {
      recommendedTerm = accountsReceivableTurnover;
    } else {
      recommendedTerm = requestedTerm;
    }

    // ── Cupo recomendado ──
    // Nunca recomendar más de lo que el cliente solicita
    // Si puede pagar más, simplemente se aprueba lo solicitado
    const maxAffordableCredit =
      monthlyPaymentCapacity > 0
        ? Math.round(monthlyPaymentCapacity * (recommendedTerm / 30))
        : 0;
    const recommendedCreditLine =
      maxAffordableCredit > 0
        ? Math.min(requestedCredit, maxAffordableCredit)
        : 0;

    // ── Dimension 4: Adecuacion del Cupo ──
    if (monthlyPaymentCapacity <= 0) {
      dimensions.creditLineAdequacy = {
        score: 0,
        maxScore: 25,
        status: 'not_applicable',
        ratio: 0,
        label: 'Adecuacion del Cupo',
        reason: 'No evaluable: la capacidad de pago es negativa, no es posible determinar un cupo viable.',
      };
      alerts.push({
        type: 'danger',
        dimension: 'creditLineAdequacy',
        message:
          'No es posible recomendar un cupo de credito dado que la capacidad de pago es negativa.',
      });
    } else {
      const maxCreditForRequestedTerm = Math.round(
        monthlyPaymentCapacity * termInMonths,
      );
      const creditRatio =
        maxCreditForRequestedTerm > 0
          ? requestedCredit / maxCreditForRequestedTerm
          : 0;

      if (creditRatio <= 1.0) {
        dimensions.creditLineAdequacy = {
          score: 25,
          maxScore: 25,
          status: 'adequate',
          ratio: Math.round(creditRatio * 1000) / 1000,
          maxCreditForRequestedTerm,
          label: 'Adecuacion del Cupo',
          reason: `El cupo solicitado ($${requestedCredit.toLocaleString('es-CO')}) no supera el maximo pagable en ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}).`,
        };
        alerts.push({
          type: 'success',
          dimension: 'creditLineAdequacy',
          message: `El cupo solicitado ($${requestedCredit.toLocaleString('es-CO')}) esta dentro de la capacidad de pago para ${requestedTerm} dias (maximo: $${maxCreditForRequestedTerm.toLocaleString('es-CO')}).`,
        });
      } else if (creditRatio <= 1.3) {
        const exceso = Math.round((creditRatio - 1) * 1000) / 10;
        dimensions.creditLineAdequacy = {
          score: 15,
          maxScore: 25,
          status: 'slightly_exceeded',
          ratio: Math.round(creditRatio * 1000) / 1000,
          maxCreditForRequestedTerm,
          label: 'Adecuacion del Cupo',
          reason: `El cupo excede un ${exceso}% el maximo pagable en ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Se recomienda ajustar cupo o ampliar plazo.`,
        };
        alerts.push({
          type: 'warning',
          dimension: 'creditLineAdequacy',
          message: `El cupo solicitado excede en un ${exceso}% el cupo maximo para ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Considere un cupo de hasta $${maxCreditForRequestedTerm.toLocaleString('es-CO')} o ampliar el plazo.`,
        });
      } else {
        const exceso = Math.round((creditRatio - 1) * 1000) / 10;
        dimensions.creditLineAdequacy = {
          score: 0,
          maxScore: 25,
          status: 'excessive',
          ratio: Math.round(creditRatio * 1000) / 1000,
          maxCreditForRequestedTerm,
          label: 'Adecuacion del Cupo',
          reason: `El cupo excede un ${exceso}% el maximo pagable en ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Es inviable sin reducir cupo o ampliar plazo.`,
        };
        alerts.push({
          type: 'danger',
          dimension: 'creditLineAdequacy',
          message: `El cupo solicitado excede en un ${exceso}% el cupo maximo para ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Se recomienda reducirlo o ampliar el plazo.`,
        });
      }
    }

    // ── Sugerencias de Pago ──
    // Genera alternativas con cuotas y plazos explícitos
    const paymentSuggestions: Array<{
      type: string;
      suggestedTerm: number;
      suggestedCredit: number;
      numberOfPayments: number;
      paymentAmount: number;
      description: string;
    }> = [];

    if (monthlyPaymentCapacity > 0) {
      const buildSuggestion = (
        type: string,
        days: number,
        credit: number,
        desc: string,
      ) => {
        const payments = Math.ceil(days / 30);
        const amount = Math.round(credit / payments);
        paymentSuggestions.push({
          type,
          suggestedTerm: days,
          suggestedCredit: credit,
          numberOfPayments: payments,
          paymentAmount: amount,
          description: desc,
        });
      };

      // Sugerencia 1: Mismo cupo, plazo ajustado
      const requiredMonths = requestedCredit / monthlyPaymentCapacity;
      const requiredDays = Math.ceil(requiredMonths * 30);
      if (requiredDays > requestedTerm) {
        const payments = Math.ceil(requiredDays / 30);
        const amount = Math.round(requestedCredit / payments);
        buildSuggestion(
          'adjusted_term',
          requiredDays,
          requestedCredit,
          `Mantener cupo de $${requestedCredit.toLocaleString('es-CO')} ampliando a ${requiredDays} dias: ${payments} cuotas de $${amount.toLocaleString('es-CO')}.`,
        );
        alerts.push({
          type: 'info',
          dimension: 'paymentSuggestions',
          message: `Para pagar $${requestedCredit.toLocaleString('es-CO')} se requiere un plazo de ${requiredDays} dias (${payments} cuotas de $${amount.toLocaleString('es-CO')}).`,
        });
      }

      // Sugerencia 2: Mismo plazo, cupo ajustado (solo si excede capacidad)
      const maxCreditForTerm = Math.round(monthlyPaymentCapacity * termInMonths);
      if (maxCreditForTerm < requestedCredit) {
        const payments = Math.ceil(requestedTerm / 30);
        const amount = Math.round(maxCreditForTerm / payments);
        buildSuggestion(
          'adjusted_credit',
          requestedTerm,
          maxCreditForTerm,
          `Mantener plazo de ${requestedTerm} dias reduciendo cupo a $${maxCreditForTerm.toLocaleString('es-CO')}: ${payments} cuotas de $${amount.toLocaleString('es-CO')}.`,
        );
      }

      // Sugerencia 3: Con plazo recomendado (rotación de cartera)
      if (recommendedTerm !== requestedTerm) {
        const maxCreditWithRecommendedTerm = Math.round(
          monthlyPaymentCapacity * (recommendedTerm / 30),
        );
        const suggestedCredit = Math.min(requestedCredit, maxCreditWithRecommendedTerm);
        const payments = Math.ceil(recommendedTerm / 30);
        const amount = Math.round(suggestedCredit / payments);
        buildSuggestion(
          'recommended_term',
          recommendedTerm,
          suggestedCredit,
          `Con plazo de ${recommendedTerm} dias (rotacion de cartera): cupo de $${suggestedCredit.toLocaleString('es-CO')} en ${payments} cuotas de $${amount.toLocaleString('es-CO')}.`,
        );
      }
    }

    dimensions.paymentSuggestions = {
      label: 'Sugerencias de Pago',
      suggestions: paymentSuggestions,
    };

    // ── Score y status final ──
    const viabilityScore =
      dimensions.financialHealth.score +
      dimensions.paymentCapacity.score +
      dimensions.termCoherence.score +
      dimensions.creditLineAdequacy.score;

    let viabilityStatus: string;
    if (monthlyPaymentCapacity <= 0) {
      viabilityStatus = 'rejected';
    } else if (viabilityScore >= 75) {
      viabilityStatus = 'approved';
    } else if (viabilityScore >= 40) {
      viabilityStatus = 'conditional';
    } else {
      viabilityStatus = 'rejected';
    }

    // ── Alertas cross-dimension ──
    if (viabilityStatus === 'conditional') {
      alerts.push({
        type: 'info',
        dimension: 'general',
        message:
          'El estudio es aprobable sujeto a las condiciones indicadas. Revise las recomendaciones de plazo y cupo.',
      });
    }

    if (
      viabilityStatus === 'rejected' &&
      monthlyPaymentCapacity > 0 &&
      dimensions.termCoherence.score === 0
    ) {
      alerts.push({
        type: 'info',
        dimension: 'general',
        message: `El cliente podria ser viable con un plazo de ${recommendedTerm} dias en lugar de ${requestedTerm} dias.`,
      });
    }

    if (inventoryTurnover === 0) {
      alerts.push({
        type: 'info',
        dimension: 'general',
        message:
          'No se registra rotacion de inventarios. Verifique si el tipo de negocio del cliente aplica para este indicador.',
      });
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

    const updated = await this.repository.update(id, {
      ebitda,
      adjustedEbitda,
      currentDebtService: currentDebtSevice,
      annualPaymentCapacity,
      monthlyPaymentCapacity,
      accountsReceivableTurnover,
      inventoryTurnover,
      suppliersTurnover,
      paymentTimeSuppliers,
      stabilityFactor,
      updatedBy: userId,
      accountsPayableTurnover,
      recommendedTerm,
      recommendedCreditLine,
      viabilityScore,
      viabilityStatus,
      viabilityConditions,
      statusId: newStatus?.id,
      resolutionDate: new Date(),
    });

    const notificationType =
      await this.parametersRepository.findByTypeAndCode('notification_type', 'credit_study');

    if (notificationType) {
      const customerName = study.customer?.businessName ?? 'Cliente';
      const statusLabel =
        viabilityStatus === 'approved'
          ? 'Aprobado'
          : viabilityStatus === 'conditional'
            ? 'Condicionado'
            : 'Rechazado';

      this.notificationsService
        .create(userId, {
          companyId,
          typeId: notificationType.id,
          title: `Estudio de crédito ${statusLabel.toLowerCase()}`,
          message: `El estudio de crédito de ${customerName} fue analizado. Resultado: ${statusLabel} (${viabilityScore}/100).`,
          route: `/app/credit-study/detail/${id}`,
        })
        .catch(() => {});
    }

    return updated;
  }
}
