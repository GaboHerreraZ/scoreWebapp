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
import { ExcelService } from '../common/excel/excel.service.js';
import type { ExcelColumn, ExcelSheet } from '../common/excel/excel.types.js';

interface ViabilityDimension {
  score?: number;
  maxScore?: number;
  status?: string;
  label?: string;
  reason?: string;
}

interface ViabilityAlert {
  type: string;
  dimension: string;
  message: string;
}

interface ViabilityConditionsShape {
  dimensions?: Record<string, ViabilityDimension>;
  alerts?: ViabilityAlert[];
  summary?: {
    totalScore?: number;
    maxScore?: number;
    status?: string;
    recommendedTerm?: number;
    recommendedCreditLine?: number;
    monthlyPaymentCapacity?: number;
    annualPaymentCapacity?: number;
  };
}

@Injectable()
export class CreditStudiesService {
  constructor(
    private readonly repository: CreditStudiesRepository,
    private readonly parametersRepository: ParametersRepository,
    private readonly notificationsService: NotificationsService,
    private readonly excelService: ExcelService,
  ) {}

  async create(companyId: string, userId: string, dto: CreateCreditStudyDto) {
    const customerBelongs = await this.repository.customerBelongsToCompany(
      dto.customerId,
      companyId,
    );
    if (!customerBelongs) {
      throw new BadRequestException('El cliente no pertenece a esta empresa');
    }

    const { customerId, studyDate, resolutionDate, ...rest } = dto;

    const newStatus = await this.parametersRepository.findByCode('inReview');

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
        `Estudio de crédito con id=${id} no encontrado en esta empresa`,
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
        `Estudio de crédito con id=${id} no encontrado en esta empresa`,
      );
    }

    if (current.status?.code === 'studyClosed') {
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
        throw new BadRequestException('El cliente no pertenece a esta empresa');
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
        `Estudio de crédito con id=${id} no encontrado en esta empresa`,
      );
    }

    if (study.status?.code === 'studyClosed') {
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
        `Estudio de crédito con id=${id} no encontrado en esta empresa`,
      );
    }

    if (study.status?.code === 'studyClosed') {
      throw new BadRequestException(
        'No se puede recalcular un estudio de crédito que ya fue completado.',
      );
    }

    //parameters
    const period = await this.parametersRepository.findById(
      study.incomeStatementId!,
    );

    const periodMonths = getMonthsFromPeriod(period?.label ?? '12');

    // calculos
    const totalAssets = study.totalAssets ?? 1;
    const x1 =
      ((study.totalCurrentAssets ?? 0) - (study.totalCurrentLiabilities ?? 0)) /
      totalAssets;
    const x2 = (study.retainedEarnings ?? 0) / totalAssets;
    // x3 = utilidad operacional / activo total
    // Utilidad operacional = grossProfit - administrativeExpenses - sellingExpenses
    const x3 =
      ((study.grossProfit ?? 0) -
        (study.administrativeExpenses ?? 0) -
        (study.sellingExpenses ?? 0)) /
      totalAssets;
    const x4 = (study.equity ?? 0) / (study.totalLiabilities ?? 1);
    const x5 = (study.ordinaryActivityRevenue ?? 0) / totalAssets;

    const result = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + x5;

    const stabilityFactor = result > 3 ? 1 : result > 1.8 ? 0.66 : 0.33;
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

    const accountsPayableTurnover1 =
      ((study.suppliers1 ?? 0) + (study.suppliers2 ?? 0)) / 2;
    const accountsPayableTurnover2 =
      (study.costOfSales ?? 0) +
      (study.inventories2 ?? 0) +
      (study.administrativeExpenses ?? 0) +
      (study.sellingExpenses ?? 0) -
      (study.inventories1 ?? 0);

    const accountsPayableTurnover =
      accountsPayableTurnover1 / accountsPayableTurnover2;

    const paymentTimeSuppliers = Math.round(accountsPayableTurnover * 365);

    const suppliersTurnover = -paymentTimeSuppliers;

    // ── Viabilidad ──────────────────────────────────────────
    const zScore = result;
    const alerts: Array<{ type: string; dimension: string; message: string }> =
      [];
    const dimensions: Record<string, any> = {};

    // ── Dimension 1: Salud Financiera (Z-Score de Altman) — 20 pts ──
    if (zScore > 3.0) {
      dimensions.financialHealth = {
        score: 20,
        maxScore: 20,
        status: 'healthy',
        label: 'Salud Financiera',
        reason:
          'Los indicadores de liquidez, rentabilidad y apalancamiento situan a la empresa en zona segura.',
      };
      alerts.push({
        type: 'success',
        dimension: 'financialHealth',
        message:
          'La empresa presenta indicadores financieros solidos con baja probabilidad de riesgo.',
      });
    } else if (zScore > 1.8) {
      dimensions.financialHealth = {
        score: 10,
        maxScore: 20,
        status: 'gray_zone',
        label: 'Salud Financiera',
        reason:
          'Los indicadores financieros situan a la empresa en zona de observacion. Se penaliza parcialmente la capacidad proyectada.',
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
        maxScore: 20,
        status: 'critical',
        label: 'Salud Financiera',
        reason:
          'Los indicadores financieros muestran alta probabilidad de dificultades. Se reduce significativamente la capacidad proyectada.',
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
        maxScore: 20,
        status: 'insufficient',
        ratio: 0,
        marginPercent: 0,
        monthlyObligation: Math.round(monthlyObligation),
        label: 'Capacidad de Pago',
        reason:
          'La empresa no genera flujo libre de efectivo despues de cubrir deudas actuales. El EBITDA ajustado no supera el servicio de deuda.',
      };
      alerts.push({
        type: 'danger',
        dimension: 'paymentCapacity',
        message: `El cliente no cuenta con capacidad de pago. El servicio de deuda actual ($${currentDebtSevice.toLocaleString('es-CO')}) supera el EBITDA ajustado.`,
      });
    } else if (paymentRatio >= 1.2) {
      dimensions.paymentCapacity = {
        score: 20,
        maxScore: 20,
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
        score: 12,
        maxScore: 20,
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
        maxScore: 20,
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

    // ── Dimension 3: Coherencia de Plazos — 20 pts — RIESGO DEL CLIENTE ──
    // Mide el riesgo de impago: si el credito vence antes de que el cliente
    // cobre a sus propios clientes, no tendra flujo para pagar.
    // IMPORTANTE: esta dimension NO empuja el plazo recomendado hacia arriba.
    // El credito es comercial SIN intereses, por lo que ampliar el plazo es
    // perjudicial para el prestamista. El desajuste solo se reporta como alerta.
    const realTerm =
      accountsReceivableTurnover > 0
        ? accountsReceivableTurnover
        : requestedTerm;

    if (accountsReceivableTurnover <= 0) {
      alerts.push({
        type: 'info',
        dimension: 'termCoherence',
        message: `No se pudo calcular la rotacion de cartera. Se usa el plazo solicitado como referencia.`,
      });
    }

    if (
      paymentTimeSuppliers > 0 &&
      paymentTimeSuppliers > accountsReceivableTurnover
    ) {
      alerts.push({
        type: 'info',
        dimension: 'termCoherence',
        message: `El tiempo de pago a proveedores (${paymentTimeSuppliers} dias) es mayor que la rotacion de cartera (${accountsReceivableTurnover} dias). La empresa paga a proveedores mas lento de lo que cobra a clientes.`,
      });
    }

    if (requestedTerm >= realTerm) {
      dimensions.termCoherence = {
        score: 20,
        maxScore: 20,
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
        score: 10,
        maxScore: 20,
        status: 'risky',
        requestedTerm,
        realTerm,
        label: 'Coherencia de Plazos',
        reason: `El plazo solicitado (${requestedTerm}d) es inferior a la rotacion de cartera (${realTerm}d) pero cubre al menos el 70%. Riesgo moderado de cobro tardio.`,
      };
      alerts.push({
        type: 'warning',
        dimension: 'termCoherence',
        message: `El plazo solicitado (${requestedTerm} dias) es inferior a la rotacion de cartera del cliente (${realTerm} dias). Existe riesgo de que el cliente aun no haya cobrado al vencer el credito.`,
      });
    } else {
      dimensions.termCoherence = {
        score: 0,
        maxScore: 20,
        status: 'incoherent',
        requestedTerm,
        realTerm,
        label: 'Coherencia de Plazos',
        reason: `El plazo solicitado (${requestedTerm}d) es menor al 70% de la rotacion de cartera (${realTerm}d). El credito vence antes de que el cliente cobre a sus clientes.`,
      };
      alerts.push({
        type: 'danger',
        dimension: 'termCoherence',
        message: `El plazo solicitado (${requestedTerm} dias) es significativamente inferior a la rotacion de cartera del cliente (${realTerm} dias). Alto riesgo de incumplimiento por cobro tardio.`,
      });
    }

    // ── Ciclo de Conversion de Efectivo (CCC) ──
    // Plazo natural del negocio del cliente, derivado de sus estados financieros.
    // CCC = rotacion de cartera + rotacion de inventarios - tiempo de pago a proveedores
    // Se usa como umbral de exposicion (Dimension 5) y para el plazo recomendado.
    //
    // Si paymentTimeSuppliers es negativo (dato atipico de la formula de rotacion
    // de proveedores), se trata como 0 para no inflar artificialmente el CCC ni
    // el umbral de exposicion. Un proveedor negativo no debe extender el ciclo.
    const supplierDays = Math.max(paymentTimeSuppliers, 0);
    const cashConversionCycle =
      accountsReceivableTurnover + inventoryTurnover - supplierDays;

    // ── Plazo recomendado ──
    // Credito comercial SIN intereses: el plazo recomendado NUNCA amplia el
    // solicitado (ampliar inmoviliza capital del prestamista sin compensacion).
    // Solo puede igualarlo o reducirlo:
    //  - nunca mayor al solicitado
    //  - puede ser menor si el ciclo de caja del cliente (CCC) es mas corto:
    //    recuperar el capital antes reduce la exposicion del prestamista
    //  - piso minimo de 30 dias: un credito comercial no baja de un mes
    const MIN_RECOMMENDED_TERM = 30;
    const cicloRef = Math.max(cashConversionCycle, MIN_RECOMMENDED_TERM);
    const recommendedTerm =
      requestedTerm > 0 ? Math.min(requestedTerm, cicloRef) : cicloRef;

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

    // ── Dimension 4: Adecuacion del Cupo — 20 pts ──
    // Cupo maximo pagable manteniendo el plazo solicitado.
    const maxCreditForRequestedTerm =
      monthlyPaymentCapacity > 0
        ? Math.round(monthlyPaymentCapacity * termInMonths)
        : 0;
    if (monthlyPaymentCapacity <= 0) {
      dimensions.creditLineAdequacy = {
        score: 0,
        maxScore: 20,
        status: 'not_applicable',
        ratio: 0,
        label: 'Adecuacion del Cupo',
        reason:
          'No evaluable: la capacidad de pago es negativa, no es posible determinar un cupo viable.',
      };
      alerts.push({
        type: 'danger',
        dimension: 'creditLineAdequacy',
        message:
          'No es posible recomendar un cupo de credito dado que la capacidad de pago es negativa.',
      });
    } else {
      const creditRatio =
        maxCreditForRequestedTerm > 0
          ? requestedCredit / maxCreditForRequestedTerm
          : 0;

      if (creditRatio <= 1.0) {
        dimensions.creditLineAdequacy = {
          score: 20,
          maxScore: 20,
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
          score: 12,
          maxScore: 20,
          status: 'slightly_exceeded',
          ratio: Math.round(creditRatio * 1000) / 1000,
          maxCreditForRequestedTerm,
          label: 'Adecuacion del Cupo',
          reason: `El cupo excede un ${exceso}% el maximo pagable en ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Se recomienda reducir el cupo.`,
        };
        alerts.push({
          type: 'warning',
          dimension: 'creditLineAdequacy',
          message: `El cupo solicitado excede en un ${exceso}% el cupo maximo para ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Considere un cupo de hasta $${maxCreditForRequestedTerm.toLocaleString('es-CO')}.`,
        });
      } else {
        const exceso = Math.round((creditRatio - 1) * 1000) / 10;
        dimensions.creditLineAdequacy = {
          score: 0,
          maxScore: 20,
          status: 'excessive',
          ratio: Math.round(creditRatio * 1000) / 1000,
          maxCreditForRequestedTerm,
          label: 'Adecuacion del Cupo',
          reason: `El cupo excede un ${exceso}% el maximo pagable en ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Es inviable sin reducir el cupo.`,
        };
        alerts.push({
          type: 'danger',
          dimension: 'creditLineAdequacy',
          message: `El cupo solicitado excede en un ${exceso}% el cupo maximo para ${requestedTerm} dias ($${maxCreditForRequestedTerm.toLocaleString('es-CO')}). Se recomienda reducirlo.`,
        });
      }
    }

    // ── Dimension 5: Exposicion / Eficiencia del Capital — 20 pts ──
    // Perspectiva del PRESTAMISTA en un credito comercial SIN intereses.
    // Mide cuanto capital propio queda inmovilizado y por cuanto tiempo,
    // relativo al ciclo de caja del cliente (CCC). Un credito puede ser
    // pagable por el cliente y aun asi ser mal negocio si la exposicion es alta.
    // El umbral es el propio ciclo del cliente (derivado de datos, sin numeros
    // fijos), por lo que el ratio es adimensional: funciona igual para $5M o $500M.
    const exposureMonths =
      monthlyPaymentCapacity > 0 ? requestedCredit / monthlyPaymentCapacity : 0;
    const healthyExposure = monthlyPaymentCapacity * (cicloRef / 30);
    const exposureRatio =
      healthyExposure > 0 ? requestedCredit / healthyExposure : 0;

    if (monthlyPaymentCapacity <= 0) {
      dimensions.capitalExposure = {
        score: 0,
        maxScore: 20,
        status: 'not_applicable',
        ratio: 0,
        exposureMonths: 0,
        cashConversionCycle,
        label: 'Exposicion / Eficiencia del Capital',
        reason:
          'No evaluable: la capacidad de pago es negativa, no es posible medir la exposicion del capital.',
      };
    } else if (exposureRatio <= 1.0) {
      dimensions.capitalExposure = {
        score: 20,
        maxScore: 20,
        status: 'efficient',
        ratio: Math.round(exposureRatio * 1000) / 1000,
        exposureMonths: Math.round(exposureMonths * 100) / 100,
        cashConversionCycle,
        label: 'Exposicion / Eficiencia del Capital',
        reason: `La exposicion (${(Math.round(exposureMonths * 100) / 100).toFixed(2)} meses de caja) respeta el ciclo de operacion del cliente. El capital prestado rota de forma eficiente.`,
      };
      alerts.push({
        type: 'success',
        dimension: 'capitalExposure',
        message:
          'El credito respeta el ciclo de caja del cliente. El capital prestado rota de forma eficiente.',
      });
    } else if (exposureRatio <= 1.5) {
      dimensions.capitalExposure = {
        score: 12,
        maxScore: 20,
        status: 'acceptable',
        ratio: Math.round(exposureRatio * 1000) / 1000,
        exposureMonths: Math.round(exposureMonths * 100) / 100,
        cashConversionCycle,
        label: 'Exposicion / Eficiencia del Capital',
        reason: `La exposicion (${(Math.round(exposureMonths * 100) / 100).toFixed(2)} meses de caja) supera levemente el ciclo de operacion del cliente. Tolerable.`,
      };
      alerts.push({
        type: 'warning',
        dimension: 'capitalExposure',
        message:
          'El credito supera levemente el ciclo de caja del cliente. La exposicion del capital es algo mayor a lo ideal.',
      });
    } else {
      dimensions.capitalExposure = {
        score: 0,
        maxScore: 20,
        status: 'excessive',
        ratio: Math.round(exposureRatio * 1000) / 1000,
        exposureMonths: Math.round(exposureMonths * 100) / 100,
        cashConversionCycle,
        label: 'Exposicion / Eficiencia del Capital',
        reason: `La exposicion (${(Math.round(exposureMonths * 100) / 100).toFixed(2)} meses de caja) supera ampliamente el ciclo de operacion del cliente. Mal negocio para el prestamista aunque el cliente pudiera pagar.`,
      };
      alerts.push({
        type: 'danger',
        dimension: 'capitalExposure',
        message:
          'El credito inmoviliza capital muy por encima del ciclo de caja del cliente. Exposicion excesiva para un credito sin intereses, incluso si el cliente pudiera pagar.',
      });
    }

    // ── Score y status final ──
    // Se calcula ANTES de las sugerencias de pago, porque las sugerencias
    // solo tienen sentido cuando el estudio es viable (aprobado o condicionado).
    const viabilityScore =
      dimensions.financialHealth.score +
      dimensions.paymentCapacity.score +
      dimensions.termCoherence.score +
      dimensions.creditLineAdequacy.score +
      dimensions.capitalExposure.score;

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

    // ── Sugerencias de Pago ──
    // Genera alternativas con cuotas y plazos explícitos.
    // Solo se generan cuando el estudio NO está rechazado: si el cliente fue
    // rechazado (por capacidad nula o por score insuficiente) no se ofrecen
    // alternativas de pago, ya que la solicitud no es viable y debe rehacerse.
    //
    // Credito comercial SIN intereses: el sistema NUNCA sugiere ampliar el plazo
    // (la antigua sugerencia 'adjusted_term' fue eliminada). Las unicas palancas
    // son: reducir el cupo manteniendo el plazo, o reducir el plazo cuando el
    // ciclo de caja del cliente lo permite (recuperar antes el capital).
    const paymentSuggestions: Array<{
      type: string;
      suggestedTerm: number;
      suggestedCredit: number;
      numberOfPayments: number;
      paymentAmount: number;
      description: string;
    }> = [];

    if (viabilityStatus !== 'rejected' && monthlyPaymentCapacity > 0) {
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

      // Sugerencia 1: Mismo plazo, cupo reducido (solo si excede capacidad)
      if (maxCreditForRequestedTerm < requestedCredit) {
        const payments = Math.ceil(requestedTerm / 30);
        const amount = Math.round(maxCreditForRequestedTerm / payments);
        buildSuggestion(
          'adjusted_credit',
          requestedTerm,
          maxCreditForRequestedTerm,
          `Mantener plazo de ${requestedTerm} dias reduciendo cupo a $${maxCreditForRequestedTerm.toLocaleString('es-CO')}: ${payments} cuotas de $${amount.toLocaleString('es-CO')}.`,
        );
      }

      // Sugerencia 2: Plazo recomendado MENOR (solo si el ciclo del cliente
      // permite recuperar antes el capital). Nunca amplia el plazo solicitado.
      if (recommendedTerm < requestedTerm) {
        const maxCreditWithRecommendedTerm = Math.round(
          monthlyPaymentCapacity * (recommendedTerm / 30),
        );
        const suggestedCredit = Math.min(
          requestedCredit,
          maxCreditWithRecommendedTerm,
        );
        const payments = Math.ceil(recommendedTerm / 30);
        const amount = Math.round(suggestedCredit / payments);
        buildSuggestion(
          'recommended_term',
          recommendedTerm,
          suggestedCredit,
          `Con plazo de ${recommendedTerm} dias (ciclo de caja del cliente): cupo de $${suggestedCredit.toLocaleString('es-CO')} en ${payments} cuotas de $${amount.toLocaleString('es-CO')}. Recuperar antes reduce la exposicion del capital.`,
        );
      }
    }

    dimensions.paymentSuggestions = {
      label: 'Sugerencias de Pago',
      suggestions: paymentSuggestions,
    };

    // ── Alertas cross-dimension ──
    if (viabilityStatus === 'conditional') {
      alerts.push({
        type: 'info',
        dimension: 'general',
        message:
          'El estudio es aprobable sujeto a las condiciones indicadas. Revise las recomendaciones de plazo y cupo.',
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
        cashConversionCycle,
        monthlyPaymentCapacity,
        annualPaymentCapacity: Math.round(annualPaymentCapacity),
      },
    };

    const newStatus =
      await this.parametersRepository.findByCode('studyCompleted');

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

    const notificationType = await this.parametersRepository.findByTypeAndCode(
      'notification_type',
      'credit_study',
    );

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

  async exportToExcel(companyId: string) {
    const studies = await this.repository.findAllForExport(companyId);

    const mainRows = studies.map((s) => ({
      studyDate: s.studyDate,
      resolutionDate: s.resolutionDate,
      status: s.status?.label ?? null,
      customerBusinessName: s.customer?.businessName ?? null,
      customerIdentification: s.customer?.identificationNumber ?? null,
      requestedTerm: s.requestedTerm,
      requestedCreditLine: s.requestedCreditLine,
      balanceSheetDate: s.balanceSheetDate,
      cashAndEquivalents: s.cashAndEquivalents,
      accountsReceivable1: s.accountsReceivable1,
      accountsReceivable2: s.accountsReceivable2,
      inventories1: s.inventories1,
      inventories2: s.inventories2,
      totalCurrentAssets: s.totalCurrentAssets,
      fixedAssetsProperty: s.fixedAssetsProperty,
      totalNonCurrentAssets: s.totalNonCurrentAssets,
      totalAssets: s.totalAssets,
      shortTermFinancialLiabilities: s.shortTermFinancialLiabilities,
      suppliers1: s.suppliers1,
      suppliers2: s.suppliers2,
      totalCurrentLiabilities: s.totalCurrentLiabilities,
      longTermFinancialLiabilities: s.longTermFinancialLiabilities,
      totalNonCurrentLiabilities: s.totalNonCurrentLiabilities,
      totalLiabilities: s.totalLiabilities,
      retainedEarnings: s.retainedEarnings,
      equity: s.equity,
      incomeStatement: s.incomeStatement?.label ?? null,
      ordinaryActivityRevenue: s.ordinaryActivityRevenue,
      costOfSales: s.costOfSales,
      grossProfit: s.grossProfit,
      administrativeExpenses: s.administrativeExpenses,
      sellingExpenses: s.sellingExpenses,
      depreciation: s.depreciation,
      amortization: s.amortization,
      financialExpenses: s.financialExpenses,
      taxes: s.taxes,
      netIncome: s.netIncome,
      recommendedTerm: s.recommendedTerm,
      recommendedCreditLine: s.recommendedCreditLine,
      viabilityScore: s.viabilityScore,
      viabilityStatus: s.viabilityStatus,
      notes: s.notes,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    const mainColumns: ExcelColumn<(typeof mainRows)[number]>[] = [
      { header: 'Fecha estudio', key: 'studyDate', type: 'date', width: 14 },
      {
        header: 'Fecha resolución',
        key: 'resolutionDate',
        type: 'date',
        width: 16,
      },
      { header: 'Estado', key: 'status', type: 'string', width: 18 },
      {
        header: 'Cliente',
        key: 'customerBusinessName',
        type: 'string',
        width: 30,
      },
      {
        header: 'Identificación cliente',
        key: 'customerIdentification',
        type: 'string',
        width: 22,
      },
      {
        header: 'Plazo solicitado (días)',
        key: 'requestedTerm',
        type: 'number',
        width: 18,
      },
      {
        header: 'Cupo solicitado',
        key: 'requestedCreditLine',
        type: 'currency',
        width: 20,
      },
      {
        header: 'Fecha balance',
        key: 'balanceSheetDate',
        type: 'date',
        width: 14,
      },
      {
        header: 'Efectivo y equivalentes',
        key: 'cashAndEquivalents',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Cuentas por cobrar 1',
        key: 'accountsReceivable1',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Cuentas por cobrar 2',
        key: 'accountsReceivable2',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Inventarios 1',
        key: 'inventories1',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Inventarios 2',
        key: 'inventories2',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Total activo corriente',
        key: 'totalCurrentAssets',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Activos fijos / propiedad',
        key: 'fixedAssetsProperty',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Total activo no corriente',
        key: 'totalNonCurrentAssets',
        type: 'currency',
        width: 24,
      },
      {
        header: 'Total activo',
        key: 'totalAssets',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Oblig. financ. CP',
        key: 'shortTermFinancialLiabilities',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Proveedores 1',
        key: 'suppliers1',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Proveedores 2',
        key: 'suppliers2',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Total pasivo corriente',
        key: 'totalCurrentLiabilities',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Oblig. financ. LP',
        key: 'longTermFinancialLiabilities',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Total pasivo no corriente',
        key: 'totalNonCurrentLiabilities',
        type: 'currency',
        width: 24,
      },
      {
        header: 'Total pasivo',
        key: 'totalLiabilities',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Ganancias acumuladas',
        key: 'retainedEarnings',
        type: 'currency',
        width: 22,
      },
      { header: 'Patrimonio', key: 'equity', type: 'currency', width: 18 },
      {
        header: 'Estado de resultados',
        key: 'incomeStatement',
        type: 'string',
        width: 20,
      },
      {
        header: 'Ingresos ordinarios',
        key: 'ordinaryActivityRevenue',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Costo de ventas',
        key: 'costOfSales',
        type: 'currency',
        width: 20,
      },
      {
        header: 'Utilidad bruta',
        key: 'grossProfit',
        type: 'currency',
        width: 20,
      },
      {
        header: 'Gastos administración',
        key: 'administrativeExpenses',
        type: 'currency',
        width: 22,
      },
      {
        header: 'Gastos de ventas',
        key: 'sellingExpenses',
        type: 'currency',
        width: 20,
      },
      {
        header: 'Depreciación',
        key: 'depreciation',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Amortización',
        key: 'amortization',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Gastos financieros',
        key: 'financialExpenses',
        type: 'currency',
        width: 20,
      },
      { header: 'Impuestos', key: 'taxes', type: 'currency', width: 16 },
      {
        header: 'Utilidad neta',
        key: 'netIncome',
        type: 'currency',
        width: 18,
      },
      {
        header: 'Plazo recomendado (días)',
        key: 'recommendedTerm',
        type: 'number',
        width: 20,
      },
      {
        header: 'Cupo recomendado',
        key: 'recommendedCreditLine',
        type: 'currency',
        width: 20,
      },
      {
        header: 'Score viabilidad',
        key: 'viabilityScore',
        type: 'number',
        width: 16,
      },
      {
        header: 'Estado viabilidad',
        key: 'viabilityStatus',
        type: 'string',
        width: 18,
      },
      { header: 'Notas', key: 'notes', type: 'string', width: 40 },
      { header: 'Creado', key: 'createdAt', type: 'datetime', width: 20 },
      { header: 'Actualizado', key: 'updatedAt', type: 'datetime', width: 20 },
    ];

    const dimensionRows: Array<{
      studyDate: Date;
      customer: string | null;
      dimension: string;
      score: number | null;
      maxScore: number | null;
      status: string | null;
      reason: string | null;
    }> = [];

    const alertRows: Array<{
      studyDate: Date;
      customer: string | null;
      type: string;
      dimension: string;
      message: string;
    }> = [];

    for (const s of studies) {
      const vc = (s.viabilityConditions ??
        null) as ViabilityConditionsShape | null;
      if (!vc) continue;

      const customerName = s.customer?.businessName ?? null;

      if (vc.dimensions) {
        for (const [key, dim] of Object.entries(vc.dimensions)) {
          if (key === 'paymentSuggestions') continue;
          dimensionRows.push({
            studyDate: s.studyDate,
            customer: customerName,
            dimension: dim.label ?? key,
            score: dim.score ?? null,
            maxScore: dim.maxScore ?? null,
            status: dim.status ?? null,
            reason: dim.reason ?? null,
          });
        }
      }

      if (vc.alerts) {
        for (const alert of vc.alerts) {
          alertRows.push({
            studyDate: s.studyDate,
            customer: customerName,
            type: alert.type,
            dimension: alert.dimension,
            message: alert.message,
          });
        }
      }
    }

    const sheets: ExcelSheet[] = [
      {
        name: 'Estudios',
        columns: mainColumns,
        data: mainRows,
      },
      {
        name: 'Viabilidad - Dimensiones',
        columns: [
          {
            header: 'Fecha estudio',
            key: 'studyDate',
            type: 'date',
            width: 14,
          },
          { header: 'Cliente', key: 'customer', type: 'string', width: 30 },
          { header: 'Dimensión', key: 'dimension', type: 'string', width: 24 },
          { header: 'Score', key: 'score', type: 'number', width: 10 },
          { header: 'Máximo', key: 'maxScore', type: 'number', width: 10 },
          { header: 'Estado', key: 'status', type: 'string', width: 18 },
          { header: 'Razón', key: 'reason', type: 'string', width: 80 },
        ],
        data: dimensionRows,
      },
      {
        name: 'Viabilidad - Alertas',
        columns: [
          {
            header: 'Fecha estudio',
            key: 'studyDate',
            type: 'date',
            width: 14,
          },
          { header: 'Cliente', key: 'customer', type: 'string', width: 30 },
          { header: 'Tipo', key: 'type', type: 'string', width: 14 },
          { header: 'Dimensión', key: 'dimension', type: 'string', width: 22 },
          { header: 'Mensaje', key: 'message', type: 'string', width: 80 },
        ],
        data: alertRows,
      },
    ];

    const timestamp = new Date().toISOString().slice(0, 10);

    return this.excelService.generate({
      fileName: `estudios-credito-${timestamp}`,
      sheets,
    });
  }
}
