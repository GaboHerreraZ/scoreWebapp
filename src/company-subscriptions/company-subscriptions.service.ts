import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository.js';
import { CreateCompanySubscriptionDto } from './dto/create-company-subscription.dto.js';
import { UpdateCompanySubscriptionDto } from './dto/update-company-subscription.dto.js';
import { FilterCompanySubscriptionDto } from './dto/filter-company-subscription.dto.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { WompiEventDto } from './dto/wompi-event.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CompanySubscriptionsService {
  private readonly logger = new Logger(CompanySubscriptionsService.name);

  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly configService: ConfigService,
  ) {}

  async create(companyId: string, dto: CreateCompanySubscriptionDto) {
    const companyExists = await this.repository.companyExists(companyId);
    if (!companyExists) {
      throw new NotFoundException(`Company with id=${companyId} not found`);
    }

    const subscription = await this.repository.findSubscriptionById(
      dto.subscriptionId,
    );
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id=${dto.subscriptionId} not found`,
      );
    }

    // Find the "activa" status parameter
    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscriptionStatus',
      'activa',
    );
    if (!activeStatus) {
      throw new NotFoundException(
        `Parameter with type=subscriptionStatus and code=activa not found`,
      );
    }

    // Auto-deactivate previous current subscription
    const currentSub = await this.repository.findCurrentByCompanyId(companyId);
    if (currentSub) {
      const upgradedStatus = await this.repository.findParameterByTypeAndCode(
        'subscriptionStatus',
        'UPGRADED',
      );
      if (upgradedStatus) {
        await this.repository.deactivateCurrentSubscription(
          companyId,
          upgradedStatus.id,
        );
      }
    }

    // Calculate dates based on subscription type
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (subscription.isMonthly) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    return this.repository.create({
      companyId,
      subscriptionId: dto.subscriptionId,
      statusId: activeStatus.id,
      startDate,
      endDate,
      isCurrent: true,
      paymentFrequency: subscription.isMonthly ? 'monthly' : 'annual',
      pricePaid: subscription.price,
    });
  }

  async findAll(companyId: string, filters: FilterCompanySubscriptionDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CompanySubscriptionWhereInput = { companyId };

    if (filters.statusId !== undefined) {
      where.statusId = filters.statusId;
    }

    if (filters.isCurrent !== undefined) {
      where.isCurrent = filters.isCurrent;
    }

    if (filters.search) {
      where.subscription = {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          {
            description: { contains: filters.search, mode: 'insensitive' },
          },
        ],
      };
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
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

  async findCurrent(companyId: string) {
    const companyExists = await this.repository.companyExists(companyId);
    if (!companyExists) {
      throw new NotFoundException(`Company with id=${companyId} not found`);
    }

    const current = await this.repository.findCurrentByCompanyId(companyId);
    if (!current) {
      throw new NotFoundException(
        `No active subscription found for company id=${companyId}`,
      );
    }
    return current;
  }

  async findById(id: string, companyId: string) {
    const companySubscription = await this.repository.findById(id, companyId);
    if (!companySubscription) {
      throw new NotFoundException(
        `Company subscription with id=${id} not found in this company`,
      );
    }
    return companySubscription;
  }

  async update(
    id: string,
    companyId: string,
    dto: UpdateCompanySubscriptionDto,
  ) {
    const current = await this.repository.findById(id, companyId);
    if (!current) {
      throw new NotFoundException(
        `Company subscription with id=${id} not found in this company`,
      );
    }

    if (dto.statusId !== undefined) {
      const statusExists = await this.repository.parameterExists(dto.statusId);
      if (!statusExists) {
        throw new NotFoundException(
          `Status parameter with id=${dto.statusId} not found`,
        );
      }
    }

    return this.repository.update(id, {
      statusId: dto.statusId,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      paymentFrequency: dto.paymentFrequency,
      pricePaid: dto.pricePaid,
      isCurrent: dto.isCurrent,
    });
  }

  async remove(id: string, companyId: string) {
    const companySubscription = await this.repository.findById(id, companyId);
    if (!companySubscription) {
      throw new NotFoundException(
        `Company subscription with id=${id} not found in this company`,
      );
    }

    return this.repository.delete(id);
  }

  async createTransaction(companyId: string, dto: CreateTransactionDto) {
    const companyExists = await this.repository.companyExists(companyId);
    if (!companyExists) {
      throw new NotFoundException(`Company with id=${companyId} not found`);
    }

    const subscription = await this.repository.findSubscriptionById(
      dto.subscriptionId,
    );
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id=${dto.subscriptionId} not found`,
      );
    }

    // Find the "activa" status parameter
    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscriptionStatus',
      'activa',
    );
    if (!activeStatus) {
      throw new NotFoundException(
        `Parameter with type=subscriptionStatus and code=activa not found`,
      );
    }

    // Check if company already has an active subscription
    const existingActive =
      await this.repository.findActiveSubscriptionByCompanyId(
        companyId,
        activeStatus.id,
      );
    if (existingActive) {
      throw new ConflictException('La empresa ya tiene una suscripción activa');
    }

    // Find the "pendiente" status parameter
    const pendingStatus = await this.repository.findParameterByTypeAndCode(
      'subscriptionStatus',
      'pendiente',
    );
    if (!pendingStatus) {
      throw new NotFoundException(
        `Parameter with type=subscriptionStatus and code=pendiente not found`,
      );
    }

    // Calculate dates based on subscription type
    const paymentId = randomUUID();
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (subscription.isMonthly) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const companySubscription = await this.repository.create({
      companyId,
      subscriptionId: dto.subscriptionId,
      statusId: pendingStatus.id,
      startDate,
      endDate,
      isCurrent: true,
      paymentFrequency: subscription.isMonthly ? 'monthly' : 'annual',
      pricePaid: subscription.price,
      paymentId,
    });

    // Generate Wompi integrity hash only for paid plans
    if (subscription.price && subscription.price > 0) {
      const amountInCents = Math.round(subscription.price * 100);
      const currency = 'COP';
      const integrityKey = this.configService.get<string>(
        'WOMPI_INTEGRITY_KEY',
      );
      const concatenated = `${paymentId}${amountInCents}${currency}${integrityKey}`;
      const integrityHash = createHash('sha256')
        .update(concatenated)
        .digest('hex');

      return { ...companySubscription, integrityHash, amountInCents };
    }

    return companySubscription;
  }

  async handleWompiEvent(event: WompiEventDto) {
    // 1. Validate checksum
    const eventsKey = this.configService.get<string>('WOMPI_EVENTS_KEY');
    const { properties, checksum } = event.signature;

    // Build concatenation from signature.properties paths + timestamp + eventsKey
    const values = properties.map((prop) => {
      const keys = prop.split('.');
      let value: unknown = event;
      for (const key of keys) {
        value = (value as Record<string, unknown>)[key];
      }
      return value;
    });

    const concatenated = `${values.join('')}${event.timestamp}${eventsKey}`;
    const computedChecksum = createHash('sha256')
      .update(concatenated)
      .digest('hex');

    if (computedChecksum !== checksum) {
      this.logger.warn(
        `Invalid Wompi checksum for reference=${event.data.transaction.reference}`,
      );
      throw new BadRequestException('Invalid event checksum');
    }

    // 2. Find the company subscription by paymentId (reference)
    const reference = event.data.transaction.reference;
    const companySubscription =
      await this.repository.findByPaymentId(reference);

    if (!companySubscription) {
      this.logger.warn(
        `No company subscription found for paymentId=${reference}`,
      );
      throw new NotFoundException(
        `Company subscription with paymentId=${reference} not found`,
      );
    }

    // 3. Handle based on transaction status
    const transactionStatus = event.data.transaction.status;

    if (transactionStatus === 'APPROVED') {
      const activeStatus = await this.repository.findParameterByTypeAndCode(
        'subscriptionStatus',
        'activa',
      );
      if (!activeStatus) {
        throw new NotFoundException(
          'Parameter with type=subscriptionStatus and code=activa not found',
        );
      }

      await this.repository.update(companySubscription.id, {
        statusId: activeStatus.id,
      });

      this.logger.log(
        `Subscription ${companySubscription.id} activated for company ${companySubscription.companyId}`,
      );
    } else if (
      transactionStatus === 'DECLINED' ||
      transactionStatus === 'VOIDED' ||
      transactionStatus === 'ERROR'
    ) {
      const rejectedStatus = await this.repository.findParameterByTypeAndCode(
        'subscriptionStatus',
        'rechazada',
      );
      if (rejectedStatus) {
        await this.repository.update(companySubscription.id, {
          statusId: rejectedStatus.id,
          isCurrent: false,
        });
      }

      this.logger.log(
        `Subscription ${companySubscription.id} rejected (${transactionStatus}) for company ${companySubscription.companyId}`,
      );
    }

    return { received: true };
  }
}
