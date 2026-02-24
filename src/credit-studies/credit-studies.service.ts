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

    return this.repository.create({
      ...rest,
      customerId,
      companyId,
      studyDate: new Date(studyDate),
      resolutionDate: resolutionDate ? new Date(resolutionDate) : undefined,
      createdBy: userId,
      updatedBy: userId,
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
      (study.depreciationAmortization ?? 0);
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
      statusId: newStatus?.id,
      resolutionDate: new Date(),
    });
  }
}
