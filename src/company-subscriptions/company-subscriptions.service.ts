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
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { MailService } from '../mail/mail.service.js';
import { SubscribeDto } from './dto/subscribe.dto.js';
import { SubscribeFreeDto } from './dto/subscribe-free.dto.js';
import { ChangePlanDto } from './dto/change-plan.dto.js';
import { EpaycoConfirmationDto } from './dto/epayco-confirmation.dto.js';

@Injectable()
export class CompanySubscriptionsService {
  private readonly logger = new Logger(CompanySubscriptionsService.name);

  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => EpaycoService))
    private readonly epaycoService: EpaycoService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly mailService: MailService,
  ) {}

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

    // 4. Guardar datos de facturación en la empresa
    const { billing } = dto;
    await this.repository.updateCompanyBilling(companyId, {
      billingName: billing.name,
      billingLastName: billing.lastName,
      billingDocTypeId: billing.docType,
      billingDocNumber: billing.docNumber,
      billingEmail: billing.email,
      billingAddress: billing.address,
      billingState: billing.state,
      billingCity: billing.city,
      billingPhone: billing.phone,
    });

    // 5. Tokenizar tarjeta con ePayco
    const { card } = dto;
    const tokenCard = await this.epaycoService.createToken(card);

    // 6. Obtener o crear cliente ePayco a nivel de empresa
    let epaycoCustomerId = company.epaycoCustomerId ?? null;

    if (!epaycoCustomerId) {
      epaycoCustomerId = await this.epaycoService.createCustomer({
        tokenCard,
        name: billing.name,
        lastName: billing.lastName,
        email: billing.email,
        city: billing.city,
        address: billing.address,
        phone: billing.phone,
      });
      await this.repository.setCompanyEpaycoCustomerId(
        companyId,
        epaycoCustomerId,
      );
    } else {
      // Cliente ePayco ya existe → actualizar tarjeta default
      await this.epaycoService.addNewToken(tokenCard, epaycoCustomerId);
    }

    // 7. Crear suscripción recurrente en ePayco
    const epaycoSubscriptionId = await this.epaycoService.createSubscription({
      idPlan: subscription.epaycoPlanId,
      customer: epaycoCustomerId,
      tokenCard,
      docType: billing.docTypeCode,
      docNumber: billing.docNumber,
      urlConfirmation: `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000')}/api/webhooks/epayco`,
    });

    // 8. Calcular fechas
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (subscription.isMonthly) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // 9. Crear company subscription activa
    const companySubscription = await this.repository.create({
      companyId,
      subscriptionId: dto.subscriptionId,
      statusId: activeStatus.id,
      startDate,
      endDate,
      isCurrent: true,
      paymentFrequency: subscription.isMonthly ? 'monthly' : 'annual',
      pricePaid: subscription.price,
      autoRenew: true,
      epaycoSubscriptionId,
    });

    // 10. Registrar primer pago en historial
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

  // ─── Cancel Subscription ─────────────────────────────────

  private async cancelCurrentSubscriptionInternal(
    companyId: string,
    opts: { skipEpaycoCancel?: boolean } = {},
  ) {
    const company = await this.repository.findCompanyById(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'active',
    );
    if (!activeStatus) {
      throw new NotFoundException('Parámetro de estado "active" no encontrado');
    }

    const currentSubscription =
      await this.repository.findActiveSubscriptionByCompanyId(
        companyId,
        activeStatus.id,
      );
    if (!currentSubscription) {
      throw new NotFoundException('La empresa no tiene una suscripción activa');
    }

    if (!opts.skipEpaycoCancel && currentSubscription.epaycoSubscriptionId) {
      try {
        await this.epaycoService.cancelSubscription(
          currentSubscription.epaycoSubscriptionId,
        );
      } catch (error: any) {
        this.logger.warn(
          `Error cancelando suscripción en ePayco (${currentSubscription.epaycoSubscriptionId}): ${error.message}`,
        );
      }
    }

    const cancelledStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'cancelled',
    );
    if (!cancelledStatus) {
      throw new NotFoundException(
        'Parámetro de estado "cancelled" no encontrado',
      );
    }

    await this.repository.update(currentSubscription.id, {
      statusId: cancelledStatus.id,
      isCurrent: false,
      autoRenew: false,
      cancelledAt: new Date(),
    });

    return { company, currentSubscription, activeStatus };
  }

  async cancel(companyId: string) {
    const { company, currentSubscription, activeStatus } =
      await this.cancelCurrentSubscriptionInternal(companyId);

    // Crear nueva suscripción gratuita
    const freePlan = await this.subscriptionsService.findByName('Gratis');
    if (!freePlan) {
      throw new NotFoundException('Plan gratuito "Gratis" no encontrado');
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    if (freePlan.isMonthly) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const freeSubscription = await this.repository.create({
      companyId,
      subscriptionId: freePlan.id,
      statusId: activeStatus.id,
      startDate,
      endDate,
      isCurrent: true,
      paymentFrequency: freePlan.isMonthly ? 'monthly' : 'annual',
      pricePaid: 0,
      autoRenew: false,
    });

    // 6. Enviar email al administrador
    const adminRole = await this.repository.findParameterByTypeAndCode(
      'user_company_role',
      'administrator',
    );
    if (adminRole) {
      const admin = await this.repository.findCompanyAdmin(
        companyId,
        adminRole.id,
      );
      const cancelledPlan = currentSubscription.subscription;
      if (admin?.email) {
        try {
          await this.mailService.sendSubscriptionCancelledEmail({
            to: admin.email,
            userName: `${admin.name} ${admin.lastName ?? ''}`.trim(),
            companyName: company.name,
            planName: cancelledPlan.name,
            maxUsers: cancelledPlan.maxUsers,
            maxCustomers: cancelledPlan.maxCustomers,
            maxStudiesPerMonth: cancelledPlan.maxStudiesPerMonth,
            maxAiAnalysisPerMonth: cancelledPlan.maxAiAnalysisPerMonth,
            maxPdfExtractionsPerMonth: cancelledPlan.maxPdfExtractionsPerMonth,
          });
        } catch (error: any) {
          this.logger.warn(
            `Error enviando correo de cancelación a ${admin.email}: ${error.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Suscripción ${currentSubscription.id} cancelada para empresa ${companyId}; nueva suscripción gratuita ${freeSubscription.id}`,
    );

    return freeSubscription;
  }

  // ─── Change Plan ─────────────────────────────────────────

  async changePlan(companyId: string, dto: ChangePlanDto) {
    // 1. Validar empresa
    const company = await this.repository.findCompanyById(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    // 2. Validar nuevo plan
    const newPlan = await this.repository.findSubscriptionById(
      dto.subscriptionId,
    );
    if (!newPlan) {
      throw new NotFoundException(
        `Plan de suscripción con id=${dto.subscriptionId} no encontrado`,
      );
    }

    // 3. Buscar suscripción activa actual
    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'active',
    );
    if (!activeStatus) {
      throw new NotFoundException('Parámetro de estado "active" no encontrado');
    }

    const currentSubscription =
      await this.repository.findActiveSubscriptionByCompanyId(
        companyId,
        activeStatus.id,
      );
    if (!currentSubscription) {
      throw new NotFoundException('La empresa no tiene una suscripción activa');
    }

    // 4. Validar que no es el mismo plan
    if (currentSubscription.subscriptionId === newPlan.id) {
      throw new BadRequestException('La empresa ya está suscrita a este plan');
    }

    // 5. Validar cupos totales (users, customers) contra el nuevo plan
    const [usersCount, customersCount] = await Promise.all([
      this.repository.countActiveUsers(companyId),
      this.repository.countCustomers(companyId),
    ]);

    const violations: Array<{
      field: string;
      current: number;
      limit: number;
      excess: number;
    }> = [];

    if (usersCount > newPlan.maxUsers) {
      violations.push({
        field: 'maxUsers',
        current: usersCount,
        limit: newPlan.maxUsers,
        excess: usersCount - newPlan.maxUsers,
      });
    }

    if (
      newPlan.maxCustomers !== null &&
      customersCount > newPlan.maxCustomers
    ) {
      violations.push({
        field: 'maxCustomers',
        current: customersCount,
        limit: newPlan.maxCustomers,
        excess: customersCount - newPlan.maxCustomers,
      });
    }

    if (violations.length > 0) {
      throw new BadRequestException({
        message:
          'No se puede cambiar al plan seleccionado: hay recursos en uso que exceden los límites del nuevo plan. Reduzca el uso antes de cambiar.',
        violations,
      });
    }

    const isNewFree = !newPlan.price || newPlan.price === 0;

    // 6a. Branch: nuevo plan es Gratis → reusar cancel + crear Gratis
    if (isNewFree) {
      return this.changeToFreePlan(
        companyId,
        currentSubscription,
        newPlan,
        activeStatus.id,
      );
    }

    // 6b. Branch: nuevo plan es pago
    if (!newPlan.epaycoPlanId) {
      throw new BadRequestException(
        `El plan "${newPlan.name}" no tiene configurado un plan en ePayco`,
      );
    }

    return this.changeToPaidPlan(
      companyId,
      company,
      currentSubscription,
      newPlan,
      activeStatus.id,
      dto,
    );
  }

  private async changeToFreePlan(
    companyId: string,
    currentSubscription: { id: string; epaycoSubscriptionId: string | null },
    newPlan: { id: string; isMonthly: boolean; name: string },
    activeStatusId: number,
  ) {
    // Cancela actual (incluye ePayco si aplica) y crea gratuita
    await this.cancelCurrentSubscriptionInternal(companyId);

    const startDate = new Date();
    const endDate = new Date(startDate);
    if (newPlan.isMonthly) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const freeSubscription = await this.repository.create({
      companyId,
      subscriptionId: newPlan.id,
      statusId: activeStatusId,
      startDate,
      endDate,
      isCurrent: true,
      paymentFrequency: newPlan.isMonthly ? 'monthly' : 'annual',
      pricePaid: 0,
      autoRenew: false,
    });

    this.logger.log(
      `Empresa ${companyId} cambió al plan gratuito "${newPlan.name}"`,
    );

    await this.notifyPlanChanged(
      companyId,
      currentSubscription,
      freeSubscription,
      newPlan,
    );

    return freeSubscription;
  }

  private async changeToPaidPlan(
    companyId: string,
    company: {
      id: string;
      billingName: string | null;
      billingLastName: string | null;
      billingDocNumber: string | null;
      billingEmail: string | null;
      billingAddress: string | null;
      billingCity: string | null;
      billingPhone: string | null;
      epaycoCustomerId: string | null;
    },
    currentSubscription: {
      id: string;
      epaycoSubscriptionId: string | null;
      subscriptionId: string;
    },
    newPlan: {
      id: string;
      name: string;
      price: number | null;
      isMonthly: boolean;
      epaycoPlanId: string | null;
    },
    activeStatusId: number,
    dto: ChangePlanDto,
  ) {
    // El epaycoCustomerId vive en la empresa (una empresa, un cliente ePayco)
    let epaycoCustomerId = company.epaycoCustomerId ?? null;
    let tokenCard: string | null = null;

    if (!epaycoCustomerId) {
      // Empresa sin cliente ePayco previo → exigir card y billing
      if (!dto.card || !dto.billing) {
        throw new BadRequestException(
          'Se requieren los datos de la tarjeta y de facturación para cambiar a un plan pago por primera vez.',
        );
      }

      tokenCard = await this.epaycoService.createToken(dto.card);

      // Actualizar billing en la empresa antes de crear el customer
      await this.repository.updateCompanyBilling(companyId, {
        billingName: dto.billing.name,
        billingLastName: dto.billing.lastName,
        billingDocTypeId: dto.billing.docType,
        billingDocNumber: dto.billing.docNumber,
        billingEmail: dto.billing.email,
        billingAddress: dto.billing.address,
        billingState: dto.billing.state,
        billingCity: dto.billing.city,
        billingPhone: dto.billing.phone,
      });

      epaycoCustomerId = await this.epaycoService.createCustomer({
        tokenCard,
        name: dto.billing.name,
        lastName: dto.billing.lastName,
        email: dto.billing.email,
        city: dto.billing.city,
        address: dto.billing.address,
        phone: dto.billing.phone,
      });
      await this.repository.setCompanyEpaycoCustomerId(
        companyId,
        epaycoCustomerId,
      );
    } else {
      // Empresa con cliente ePayco existente
      if (dto.card) {
        // Cliente quiere reemplazar tarjeta → tokenizar y agregar al customer
        tokenCard = await this.epaycoService.createToken(dto.card);
        await this.epaycoService.addNewToken(tokenCard, epaycoCustomerId);
      } else {
        // Reusar la tarjeta default del customer existente
        tokenCard =
          await this.epaycoService.getDefaultTokenCard(epaycoCustomerId);
        if (!tokenCard) {
          throw new BadRequestException(
            'No se encontró una tarjeta válida para el cliente. Envíe una nueva tarjeta para continuar.',
          );
        }
      }

      if (dto.billing) {
        await this.repository.updateCompanyBilling(companyId, {
          billingName: dto.billing.name,
          billingLastName: dto.billing.lastName,
          billingDocTypeId: dto.billing.docType,
          billingDocNumber: dto.billing.docNumber,
          billingEmail: dto.billing.email,
          billingAddress: dto.billing.address,
          billingState: dto.billing.state,
          billingCity: dto.billing.city,
          billingPhone: dto.billing.phone,
        });
      }
    }

    // Resolver doc para la suscripción ePayco
    const billingDocNumber =
      dto.billing?.docNumber ?? company.billingDocNumber ?? '';
    const billingDocTypeCode = dto.billing?.docTypeCode ?? 'CC';

    if (!billingDocNumber) {
      throw new BadRequestException(
        'La empresa no tiene número de documento de facturación configurado.',
      );
    }

    // Crear suscripción nueva en ePayco — punto crítico de falla
    let newEpaycoSubscriptionId: string;
    try {
      newEpaycoSubscriptionId = await this.epaycoService.createSubscription({
        idPlan: newPlan.epaycoPlanId!,
        customer: epaycoCustomerId,
        tokenCard,
        docType: billingDocTypeCode,
        docNumber: billingDocNumber,
        urlConfirmation: `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000')}/api/webhooks/epayco`,
      });
    } catch (error) {
      // Falló el pago/suscripción ePayco → no tocamos BD, propagamos el error
      this.logger.warn(
        `Cambio de plan falló en ePayco para empresa ${companyId}: ${error?.message ?? error}`,
      );
      throw error;
    }

    // Cambios en BD: si fallan, hacemos rollback en ePayco (saga compensatoria)
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (newPlan.isMonthly) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const cancelledStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'cancelled',
    );
    if (!cancelledStatus) {
      // Compensación: cancelar la suscripción ePayco recién creada
      await this.safeCancelEpaycoSubscription(newEpaycoSubscriptionId);
      throw new NotFoundException(
        'Parámetro de estado "cancelled" no encontrado',
      );
    }

    let newCompanySubscription;
    try {
      // Marca la actual como cancelada y crea la nueva activa en una transacción
      newCompanySubscription = await this.repository.replaceCurrentSubscription(
        {
          currentSubscriptionId: currentSubscription.id,
          cancelledStatusId: cancelledStatus.id,
          newData: {
            companyId,
            subscriptionId: newPlan.id,
            statusId: activeStatusId,
            startDate,
            endDate,
            isCurrent: true,
            paymentFrequency: newPlan.isMonthly ? 'monthly' : 'annual',
            pricePaid: newPlan.price ?? 0,
            autoRenew: true,
            epaycoSubscriptionId: newEpaycoSubscriptionId,
          },
          firstPayment: {
            periodStart: startDate,
            periodEnd: endDate,
            amount: newPlan.price ?? 0,
            currencyCode: 'COP',
            responseCode: 200,
            responseMessage: 'Cambio de plan exitoso',
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Falló la actualización en BD del cambio de plan para empresa ${companyId}; se cancela la suscripción ePayco creada.`,
        error,
      );
      await this.safeCancelEpaycoSubscription(newEpaycoSubscriptionId);
      throw new BadRequestException(
        'Error guardando el cambio de plan. La operación fue revertida.',
      );
    }

    // Cancelar la suscripción ePayco anterior (si existía) — al final, mejor effort
    if (currentSubscription.epaycoSubscriptionId) {
      try {
        await this.epaycoService.cancelSubscription(
          currentSubscription.epaycoSubscriptionId,
        );
      } catch (error: any) {
        this.logger.warn(
          `Error cancelando la suscripción ePayco anterior (${currentSubscription.epaycoSubscriptionId}): ${error.message}. La nueva suscripción ya está activa.`,
        );
      }
    }

    this.logger.log(
      `Empresa ${companyId} cambió al plan "${newPlan.name}" (ePayco subscription=${newEpaycoSubscriptionId})`,
    );

    await this.notifyPlanChanged(
      companyId,
      currentSubscription,
      newCompanySubscription,
      newPlan,
    );

    return newCompanySubscription;
  }

  private async safeCancelEpaycoSubscription(epaycoSubscriptionId: string) {
    try {
      await this.epaycoService.cancelSubscription(epaycoSubscriptionId);
    } catch (error: any) {
      this.logger.error(
        `Error en compensación: no se pudo cancelar la suscripción ePayco ${epaycoSubscriptionId}: ${error.message}. Se requiere intervención manual.`,
      );
    }
  }

  private async notifyPlanChanged(
    companyId: string,
    _previousSubscription: { id: string },
    _newCompanySubscription: { id: string },
    newPlan: { name: string },
  ) {
    const adminRole = await this.repository.findParameterByTypeAndCode(
      'user_company_role',
      'administrator',
    );
    if (!adminRole) return;

    const admin = await this.repository.findCompanyAdmin(
      companyId,
      adminRole.id,
    );
    if (!admin?.email) return;

    try {
      await this.mailService.sendPlanChangedEmail({
        to: admin.email,
        userName: `${admin.name} ${admin.lastName ?? ''}`.trim(),
        newPlanName: newPlan.name,
      });
    } catch (error: any) {
      this.logger.warn(
        `Error enviando correo de cambio de plan a ${admin.email}: ${error.message}`,
      );
    }
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
      this.logger.warn(`Firma ePayco inválida para ref=${dto.x_ref_payco}`);
      throw new BadRequestException('Firma inválida');
    }

    // 2. Buscar la suscripción activa por el documento de facturación
    const customerDoc = dto.x_customer_document;
    if (!customerDoc) {
      this.logger.warn(
        `Webhook sin x_customer_document, ref=${dto.x_ref_payco}`,
      );
      throw new BadRequestException(
        'Documento del cliente no encontrado en la confirmación',
      );
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
      const alreadyProcessed =
        await this.repository.paymentExistsByTransactionId(
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
