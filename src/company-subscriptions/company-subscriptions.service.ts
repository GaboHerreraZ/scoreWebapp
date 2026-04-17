import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository.js';
import { EpaycoService } from '../epayco/epayco.service.js';
import { CreateCompanySubscriptionDto } from './dto/create-company-subscription.dto.js';
import { UpdateCompanySubscriptionDto } from './dto/update-company-subscription.dto.js';
import { FilterCompanySubscriptionDto } from './dto/filter-company-subscription.dto.js';
import { SubscribeDto } from './dto/subscribe.dto.js';
import { SubscribeFreeDto } from './dto/subscribe-free.dto.js';
import { EpaycoConfirmationDto } from './dto/epayco-confirmation.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CompanySubscriptionsService {
  private readonly logger = new Logger(CompanySubscriptionsService.name);

  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => EpaycoService))
    private readonly epaycoService: EpaycoService,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────

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

    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'active',
    );
    if (!activeStatus) {
      throw new NotFoundException(
        `Parameter with type=subscription_status and code=active not found`,
      );
    }

    // Auto-deactivate previous current subscription
    const currentSub = await this.repository.findCurrentByCompanyId(companyId);
    if (currentSub) {
      const upgradedStatus = await this.repository.findParameterByTypeAndCode(
        'subscription_status',
        'UPGRADED',
      );
      if (upgradedStatus) {
        await this.repository.deactivateCurrentSubscription(
          companyId,
          upgradedStatus.id,
        );
      }
    }

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

  async checkTransaction(companySubscriptionId: string) {
    const companySubscription =
      await this.repository.findByIdGlobal(companySubscriptionId);
    if (!companySubscription) {
      throw new NotFoundException(
        `Company subscription with id=${companySubscriptionId} not found`,
      );
    }
    return companySubscription;
  }

  // ─── Free Subscription Flow ───────────────────────────────

  async subscribeFree(companyId: string, dto: SubscribeFreeDto) {
    const companyExists = await this.repository.companyExists(companyId);
    if (!companyExists) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    const subscription = await this.repository.findSubscriptionById(
      dto.subscriptionId,
    );
    if (!subscription) {
      throw new NotFoundException(
        `Plan de suscripción con id=${dto.subscriptionId} no encontrado`,
      );
    }

    if (subscription.price && subscription.price > 0) {
      throw new BadRequestException(
        'Este endpoint es solo para planes gratuitos',
      );
    }

    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'active',
    );
    if (!activeStatus) {
      throw new NotFoundException('Parámetro de estado "active" no encontrado');
    }

    const existingActive =
      await this.repository.findActiveSubscriptionByCompanyId(
        companyId,
        activeStatus.id,
      );
    if (existingActive) {
      throw new ConflictException('La empresa ya tiene una suscripción activa');
    }

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
      statusId: activeStatus.id,
      startDate,
      endDate,
      isCurrent: true,
      paymentFrequency: subscription.isMonthly ? 'monthly' : 'annual',
      pricePaid: 0,
      autoRenew: false,
    });

    this.logger.log(
      `Empresa ${companyId} suscrita al plan gratuito "${subscription.name}"`,
    );

    return companySubscription;
  }

  // ─── ePayco Subscription Flow ────────────────────────────

  async subscribe(companyId: string, dto: SubscribeDto) {
    // 1. Validar que la empresa existe
    const company = await this.repository.findCompanyById(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    // 2. Validar que el plan existe y tiene epaycoPlanId
    const subscription = await this.repository.findSubscriptionById(
      dto.subscriptionId,
    );

    if (!subscription) {
      throw new NotFoundException(
        `Plan de suscripción con id=${dto.subscriptionId} no encontrado`,
      );
    }
    if (!subscription.epaycoPlanId) {
      throw new BadRequestException(
        `El plan "${subscription.name}" no tiene configurado un plan en ePayco`,
      );
    }

    // 3. Verificar que no tenga suscripción activa
    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'active',
    );
    if (!activeStatus) {
      throw new NotFoundException(
        'Parámetro de estado "active" no encontrado',
      );
    }

    const existingActive =
      await this.repository.findActiveSubscriptionByCompanyId(
        companyId,
        activeStatus.id,
      );
    if (existingActive) {
      throw new ConflictException('La empresa ya tiene una suscripción activa');
    }

    // 4. Guardar datos de facturación en la empresa
    const { billing } = dto;
    await this.repository.updateCompanyBilling(companyId, {
      billingName: billing.name,
      billingLastName: billing.lastName,
      billingDocNumber: billing.docNumber,
      billingEmail: billing.email,
      billingAddress: billing.address,
      billingState: billing.state,
      billingCity: billing.city,
      billingPhone: billing.phone,
    });

    // 5. Buscar intento pendiente previo (reintento de pago)
    const pendingStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'pending',
    );
    const existingPending = pendingStatus
      ? await this.repository.findPendingByCompanyId(companyId, pendingStatus.id)
      : null;

    // 6. Tokenizar tarjeta con ePayco
    const { card } = dto;
    const tokenCard = await this.epaycoService.createToken(card);

    // 7. Obtener o crear cliente en ePayco
    let epaycoCustomerId = existingPending?.epaycoCustomerId;

    if (!epaycoCustomerId) {
      // Primera vez: crear cliente
      epaycoCustomerId = await this.epaycoService.createCustomer({
        tokenCard,
        name: billing.name,
        lastName: billing.lastName,
        email: billing.email,
        city: billing.city,
        address: billing.address,
        phone: billing.phone,
      });

      // Guardar customerId en registro pending para reintentos
      if (!existingPending && pendingStatus) {
        await this.repository.create({
          companyId,
          subscriptionId: dto.subscriptionId,
          statusId: pendingStatus.id,
          startDate: new Date(),
          endDate: new Date(),
          isCurrent: false,
          pricePaid: subscription.price,
          epaycoCustomerId,
          campaignId: dto.campaignId,
        });
      }
    } else {
      // Reintento: actualizar token en el cliente existente
      await this.epaycoService.addNewToken(tokenCard, epaycoCustomerId);
    }

    // 8. Crear suscripción recurrente en ePayco
    const epaycoSubscriptionId = await this.epaycoService.createSubscription({
      idPlan: subscription.epaycoPlanId,
      customer: epaycoCustomerId,
      tokenCard,
      docType: billing.docType,
      docNumber: billing.docNumber,
      urlConfirmation: `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000')}/api/webhooks/epayco`,
    });

    // 9. Calcular fechas
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (subscription.isMonthly) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // 10. Actualizar registro pending existente o crear uno nuevo como activo
    let companySubscription;
    if (existingPending) {
      companySubscription = await this.repository.update(existingPending.id, {
        statusId: activeStatus.id,
        startDate,
        endDate,
        isCurrent: true,
        paymentFrequency: subscription.isMonthly ? 'monthly' : 'annual',
        pricePaid: subscription.price,
        autoRenew: true,
        epaycoCustomerId,
        epaycoSubscriptionId,
        campaignId: dto.campaignId,
      });
    } else {
      // Buscar el pending que creamos en el paso 7 (si existe)
      const justCreatedPending = pendingStatus
        ? await this.repository.findPendingByCompanyId(companyId, pendingStatus.id)
        : null;

      if (justCreatedPending) {
        companySubscription = await this.repository.update(justCreatedPending.id, {
          statusId: activeStatus.id,
          startDate,
          endDate,
          isCurrent: true,
          paymentFrequency: subscription.isMonthly ? 'monthly' : 'annual',
          autoRenew: true,
          epaycoSubscriptionId,
        });
      } else {
        companySubscription = await this.repository.create({
          companyId,
          subscriptionId: dto.subscriptionId,
          statusId: activeStatus.id,
          startDate,
          endDate,
          isCurrent: true,
          paymentFrequency: subscription.isMonthly ? 'monthly' : 'annual',
          pricePaid: subscription.price,
          autoRenew: true,
          epaycoCustomerId,
          epaycoSubscriptionId,
          campaignId: dto.campaignId,
        });
      }
    }

    // 11. Registrar primer pago en historial
    await this.repository.createPaymentHistory({
      companySubscriptionId: companySubscription.id,
      periodStart: startDate,
      periodEnd: endDate,
      amount: subscription.price ?? 0,
      currencyCode: 'COP',
      responseCode: 200,
      responseMessage: 'Suscripción inicial creada exitosamente',
    });

    this.logger.log(
      `Empresa ${companyId} suscrita al plan "${subscription.name}" (ePayco subscription=${epaycoSubscriptionId})`,
    );

    return companySubscription;
  }

  async findPaymentHistory(
    companyId: string,
    companySubscriptionId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const sub = await this.repository.findById(companySubscriptionId, companyId);
    if (!sub) {
      throw new NotFoundException(
        `Suscripción con id=${companySubscriptionId} no encontrada en esta empresa`,
      );
    }

    const skip = (page - 1) * limit;
    const { data, total } = await this.repository.findPaymentsBySubscriptionId(
      companySubscriptionId,
      skip,
      limit,
    );

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── ePayco Webhook ──────────────────────────────────────

  private validateEpaycoSignature(dto: EpaycoConfirmationDto): boolean {
    const pCustId = this.configService.get<string>('EPAYCO_P_CUST_ID');
    const pKey = this.configService.get<string>('EPAYCO_P_KEY');

    const concatenated = `${pCustId}^${pKey}^${dto.x_ref_payco}^${dto.x_transaction_id}^${dto.x_amount}^${dto.x_currency_code}`;
    const computedSignature = createHash('sha256')
      .update(concatenated)
      .digest('hex');

    return computedSignature === dto.x_signature;
  }

  async handleEpaycoConfirmation(dto: EpaycoConfirmationDto) {
    this.logger.log(
      `Webhook ePayco recibido: ref=${dto.x_ref_payco}, cod_response=${dto.x_cod_response}, customer_doc=${dto.x_customer_document}`,
    );

    // 1. Validar firma
    const isValid = this.validateEpaycoSignature(dto);
    if (!isValid) {
      this.logger.warn(
        `Firma ePayco inválida para ref=${dto.x_ref_payco}`,
      );
      throw new BadRequestException('Firma inválida');
    }

    // 2. Buscar la suscripción activa por el documento de facturación
    const customerDoc = dto.x_customer_document;
    if (!customerDoc) {
      this.logger.warn(
        `Webhook sin x_customer_document, ref=${dto.x_ref_payco}`,
      );
      throw new BadRequestException('Documento del cliente no encontrado en la confirmación');
    }

    const companySubscription =
      await this.repository.findActiveByBillingDoc(customerDoc);
    if (!companySubscription) {
      this.logger.warn(
        `No se encontró suscripción activa para documento=${customerDoc}`,
      );
      throw new NotFoundException(
        `Suscripción no encontrada para el documento ${customerDoc}`,
      );
    }

    // 3. Idempotencia: verificar si ya procesamos esta transacción
    if (dto.x_transaction_id) {
      const alreadyProcessed = await this.repository.paymentExistsByTransactionId(
        dto.x_transaction_id,
      );
      if (alreadyProcessed) {
        this.logger.log(
          `Webhook duplicado ignorado: transacción=${dto.x_transaction_id}`,
        );
        return { received: true };
      }
    }

    const responseCode = parseInt(dto.x_cod_response ?? '0', 10);
    const currentEndDate = new Date(companySubscription.endDate);

    if (responseCode === 1) {
      // Cobro exitoso → renovar período
      const subscription = companySubscription.subscription;
      const newEndDate = new Date(currentEndDate);
      if (subscription.isMonthly) {
        newEndDate.setMonth(newEndDate.getMonth() + 1);
      } else {
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);
      }

      await this.repository.update(companySubscription.id, {
        endDate: newEndDate,
      });

      await this.repository.createPaymentHistory({
        companySubscriptionId: companySubscription.id,
        periodStart: currentEndDate,
        periodEnd: newEndDate,
        amount: parseFloat(dto.x_amount ?? '0'),
        currencyCode: dto.x_currency_code ?? 'COP',
        epaycoRef: dto.x_ref_payco,
        epaycoTransactionId: dto.x_transaction_id,
        responseCode: 200,
        responseMessage: dto.x_response,
        franchise: dto.x_franchise,
        approvalCode: dto.x_approval_code,
      });

      this.logger.log(
        `Suscripción ${companySubscription.id} renovada hasta ${newEndDate.toISOString()} (empresa=${companySubscription.companyId})`,
      );
    } else if (responseCode === 2 || responseCode === 4) {
      // Cobro rechazado o fallido
      const rejectedStatus = await this.repository.findParameterByTypeAndCode(
        'subscription_status',
        'rejected',
      );
      if (rejectedStatus) {
        await this.repository.update(companySubscription.id, {
          statusId: rejectedStatus.id,
          isCurrent: false,
          autoRenew: false,
        });
      }

      await this.repository.createPaymentHistory({
        companySubscriptionId: companySubscription.id,
        periodStart: currentEndDate,
        periodEnd: currentEndDate,
        amount: parseFloat(dto.x_amount ?? '0'),
        currencyCode: dto.x_currency_code ?? 'COP',
        epaycoRef: dto.x_ref_payco,
        epaycoTransactionId: dto.x_transaction_id,
        responseCode,
        responseMessage: dto.x_response,
        franchise: dto.x_franchise,
        approvalCode: dto.x_approval_code,
      });

      this.logger.warn(
        `Suscripción ${companySubscription.id} rechazada (código=${responseCode}) empresa=${companySubscription.companyId}`,
      );
    } else if (responseCode === 3) {
      this.logger.log(
        `Suscripción ${companySubscription.id} pendiente de confirmación (ref=${dto.x_ref_payco})`,
      );
    }

    return { received: true };
  }
}
