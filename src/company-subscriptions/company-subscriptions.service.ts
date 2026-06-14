import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository.js';
import { EpaycoService } from '../epayco/epayco.service.js';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { MailService } from '../mail/mail.service.js';
import { ChangePlanDto } from './dto/change-plan.dto.js';
import { PayOnboardingDto } from './dto/pay-onboarding.dto.js';
import { EpaycoConfirmationDto } from './dto/epayco-confirmation.dto.js';

@Injectable()
export class CompanySubscriptionsService {
  private readonly logger = new Logger(CompanySubscriptionsService.name);

  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly configService: ConfigService,
    private readonly epaycoService: EpaycoService,
    private readonly consultationPricesService: ConsultationPricesService,
    private readonly mailService: MailService,
  ) {}

  // ─── Cálculo de precio por consulta ───────────────────────

  /**
   * Calcula el precio total de un plan = nº de consultas incluidas
   * (maxStudiesPerMonth) × precio unitario de la consulta vigente.
   * Devuelve el total congelado y el id del ConsultationPrice usado, para
   * guardarlos en la CompanySubscription. Un plan sin consultas (0/null) es
   * gratis: total 0 y sin referencia de precio.
   */
  private async resolvePlanPrice(maxStudiesPerMonth: number | null): Promise<{
    pricePaid: number;
    consultationPriceId: string | null;
  }> {
    const studies = maxStudiesPerMonth ?? 0;
    if (studies <= 0) {
      return { pricePaid: 0, consultationPriceId: null };
    }

    const consultationPrice =
      await this.consultationPricesService.getActivePrice();
    if (!consultationPrice) {
      throw new BadRequestException(
        'No hay un precio de consulta activo configurado. Configure un ConsultationPrice antes de crear suscripciones pagas.',
      );
    }

    return {
      pricePaid: studies * consultationPrice.unitPrice,
      consultationPriceId: consultationPrice.id,
    };
  }

  // ─── Pago de onboarding (checkout propio) ─────────────────

  /**
   * Carga el resumen de pago para la página de checkout propia. El link del
   * correo trae companySubscriptionId + token; validamos el token y que aún
   * esté pendiente de pago. No requiere sesión.
   */
  async getPaymentSummary(companySubscriptionId: string, token: string) {
    const cs = await this.repository.findByIdWithDetails(companySubscriptionId);
    if (!cs || !cs.paymentToken || cs.paymentToken !== token) {
      throw new NotFoundException('Enlace de pago inválido o expirado');
    }

    const pendingStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'pending_payment',
    );
    const alreadyPaid = pendingStatus
      ? cs.statusId !== pendingStatus.id
      : false;

    const studies =
      cs.maxStudiesPerMonthOverride ?? cs.subscription.maxStudiesPerMonth ?? 0;

    return {
      companyName: cs.company.name,
      planName: cs.subscription.name,
      studiesPerMonth: studies,
      maxUsers: cs.maxUsersOverride ?? cs.subscription.maxUsers,
      amount: cs.pricePaid ?? 0,
      currency: 'COP',
      isMonthly: cs.subscription.isMonthly,
      paymentFrequency: cs.subscription.isMonthly ? 'monthly' : 'annual',
      startDate: cs.startDate,
      endDate: cs.endDate,
      alreadyPaid,
    };
  }

  /**
   * Procesa el pago inicial del onboarding: tokeniza la tarjeta, crea el
   * cliente, crea un plan dinámico en ePayco con el monto personalizado y la
   * suscripción recurrente. Marca la CompanySubscription como activa.
   */
  async payOnboarding(dto: PayOnboardingDto) {
    const cs = await this.repository.findByIdWithDetails(
      dto.companySubscriptionId,
    );
    if (!cs || !cs.paymentToken || cs.paymentToken !== dto.token) {
      throw new NotFoundException('Enlace de pago inválido o expirado');
    }

    const [pendingStatus, activeStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode(
        'subscription_status',
        'pending_payment',
      ),
      this.repository.findParameterByTypeAndCode(
        'subscription_status',
        'active',
      ),
    ]);
    if (!pendingStatus || !activeStatus) {
      throw new BadRequestException(
        'Faltan parámetros de estado de suscripción (pending_payment / active)',
      );
    }
    if (cs.statusId !== pendingStatus.id) {
      throw new ConflictException('Esta suscripción ya fue pagada');
    }

    const amount = cs.pricePaid ?? 0;
    if (amount <= 0) {
      throw new BadRequestException(
        'El monto de la suscripción no es válido para procesar el pago',
      );
    }

    // Claim atómico: consume el paymentToken para que dos pagos concurrentes
    // (doble clic / dos pestañas) no creen dos suscripciones ePayco. Sólo el
    // primer request gana; el resto recibe el conflicto.
    const claimed = await this.repository.claimPaymentToken(cs.id, dto.token);
    if (!claimed) {
      throw new ConflictException(
        'Este pago ya está siendo procesado o la suscripción ya fue pagada.',
      );
    }

    const { card, billing } = dto;

    // 1. Guardar billing en la empresa ANTES de tocar ePayco (barato y reversible;
    //    si algo en ePayco falla, no quedan cobros huérfanos por este paso).
    await this.repository.updateCompanyBilling(cs.companyId, {
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

    // Pasos en ePayco (tokenizar → cliente → plan → suscripción). Si algo falla
    // ANTES de tener la suscripción creada, restauramos el paymentToken para que
    // el cliente pueda reintentar con el mismo link (no perdió el acceso al pago).
    let epaycoSubscriptionId: string;
    let epaycoPlanId: string;
    try {
      // 2. Tokenizar tarjeta
      const tokenCard = await this.epaycoService.createToken(card);

      // 3. Crear cliente ePayco (a nivel de empresa) o reutilizar
      let epaycoCustomerId = cs.company.epaycoCustomerId ?? null;
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
          cs.companyId,
          epaycoCustomerId,
        );
      } else {
        await this.epaycoService.addNewToken(tokenCard, epaycoCustomerId);
      }

      // 4. Crear plan dinámico en ePayco con el monto personalizado. El id_plan
      //    lleva un sufijo aleatorio para no colisionar si se reintenta un pago.
      const interval = cs.subscription.isMonthly ? 'month' : 'year';
      const idPlan = `cs_${cs.id}_${randomBytes(4).toString('hex')}`;
      epaycoPlanId = await this.epaycoService.createPlan({
        idPlan,
        name: `${cs.subscription.name} - ${cs.company.name}`.slice(0, 90),
        description: `Suscripción ${cs.subscription.name} (${interval}) para ${cs.company.name}`,
        amount,
        interval,
      });

      // 5. Crear la suscripción recurrente
      epaycoSubscriptionId = await this.epaycoService.createSubscription({
        idPlan: epaycoPlanId,
        customer: epaycoCustomerId,
        tokenCard,
        docType: billing.docTypeCode,
        docNumber: billing.docNumber,
        urlConfirmation: `${this.configService.get<string>('BACKEND_PUBLIC_URL', 'http://localhost:3000')}/api/webhooks/epayco`,
      });
    } catch (error) {
      // Aún no hay cobro confirmado: devolvemos el token para permitir reintento.
      await this.repository.restorePaymentToken(
        cs.id,
        dto.token,
        pendingStatus.id,
      );
      throw error;
    }

    // 6. Activar la suscripción y registrar el pago (atómico). Si falla, saga
    //    compensatoria: cancelar la suscripción ePayco creada y restaurar el token.
    let updated;
    try {
      updated = await this.repository.activateAfterPayment({
        companySubscriptionId: cs.id,
        activeStatusId: activeStatus.id,
        epaycoPlanId,
        epaycoSubscriptionId,
        firstPayment: {
          periodStart: cs.startDate,
          periodEnd: cs.endDate,
          amount,
          currencyCode: 'COP',
          responseCode: 200,
          responseMessage: 'Pago inicial de onboarding procesado',
        },
      });
    } catch (error) {
      this.logger.error(
        `Falló el commit en BD del pago de onboarding (empresa ${cs.companyId}); se cancela la suscripción ePayco creada.`,
        error,
      );
      await this.safeCancelEpaycoSubscription(epaycoSubscriptionId);
      await this.repository.restorePaymentToken(
        cs.id,
        dto.token,
        pendingStatus.id,
      );
      throw new BadRequestException(
        'Error guardando el pago. La operación fue revertida; por favor intenta de nuevo.',
      );
    }

    this.logger.log(
      `Empresa ${cs.companyId} pagó su suscripción de onboarding (ePayco subscription=${epaycoSubscriptionId})`,
    );

    return {
      paid: true,
      companySubscriptionId: updated.id,
      epaycoSubscriptionId,
    };
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
    // Cancela la suscripción activa. NO se crea ningún plan de reemplazo:
    // sin suscripción activa la empresa pierde acceso al sistema.
    const { company, currentSubscription } =
      await this.cancelCurrentSubscriptionInternal(companyId);

    // Notificar al administrador de la empresa
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
      `Suscripción ${currentSubscription.id} cancelada para empresa ${companyId}; la empresa queda sin suscripción activa`,
    );

    return {
      cancelled: true,
      subscriptionId: currentSubscription.id,
    };
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

    // El plan ePayco se crea dinámicamente con el monto calculado del nuevo
    // nivel (no se requiere un plan preconfigurado en ePayco).
    return this.changeToPaidPlan(
      companyId,
      company,
      currentSubscription,
      newPlan,
      activeStatus.id,
      dto,
    );
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
      maxStudiesPerMonth: number | null;
      isMonthly: boolean;
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

    // Precio del nuevo nivel (= estudios × precio consulta vigente). Define el
    // monto del plan dinámico que se cobrará en ePayco.
    const { pricePaid, consultationPriceId } = await this.resolvePlanPrice(
      newPlan.maxStudiesPerMonth,
    );

    // Crear plan dinámico + suscripción nueva en ePayco — punto crítico de falla.
    const interval = newPlan.isMonthly ? 'month' : 'year';
    let newEpaycoPlanId: string;
    let newEpaycoSubscriptionId: string;
    try {
      newEpaycoPlanId = await this.epaycoService.createPlan({
        idPlan: `cs_${currentSubscription.id}_${randomBytes(4).toString('hex')}`,
        name: `${newPlan.name} - ${companyId}`.slice(0, 90),
        description: `Cambio de plan a ${newPlan.name} (${interval})`,
        amount: pricePaid,
        interval,
      });

      newEpaycoSubscriptionId = await this.epaycoService.createSubscription({
        idPlan: newEpaycoPlanId,
        customer: epaycoCustomerId,
        tokenCard,
        docType: billingDocTypeCode,
        docNumber: billingDocNumber,
        urlConfirmation: `${this.configService.get<string>('BACKEND_PUBLIC_URL', 'http://localhost:3000')}/api/webhooks/epayco`,
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
            pricePaid,
            consultationPriceId,
            autoRenew: true,
            epaycoPlanId: newEpaycoPlanId,
            epaycoSubscriptionId: newEpaycoSubscriptionId,
          },
          firstPayment: {
            periodStart: startDate,
            periodEnd: endDate,
            amount: pricePaid,
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

  /**
   * Destinatarios de notificación de una empresa: admin activo + correo de
   * facturación, deduplicados (case-insensitive). Devuelve también un nombre
   * legible para el saludo del correo.
   */
  private async resolveNotificationRecipients(
    companyId: string,
    billingEmail: string | null,
    billingName: string | null,
    billingLastName: string | null,
  ): Promise<{ to: string[]; userName: string }> {
    const adminRole = await this.repository.findParameterByTypeAndCode(
      'user_company_role',
      'administrator',
    );
    const admin = adminRole
      ? await this.repository.findCompanyAdmin(companyId, adminRole.id)
      : null;

    const seen = new Set<string>();
    const to: string[] = [];
    const push = (email?: string | null) => {
      if (!email) return;
      const key = email.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      to.push(email);
    };
    push(admin?.email);
    push(billingEmail);

    const userName = admin
      ? `${admin.name} ${admin.lastName ?? ''}`.trim()
      : `${billingName ?? ''} ${billingLastName ?? ''}`.trim() || 'cliente';

    return { to, userName };
  }

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
      // El primer cobro corresponde al pago inicial ya registrado en
      // payOnboarding (sin epaycoTransactionId): lo conciliamos adjuntándole los
      // datos del webhook y NO extendemos el periodo (ya estaba cubierto). Sólo
      // los cobros posteriores (renovaciones) extienden el periodo.
      const initialPayment =
        await this.repository.findUnreconciledInitialPayment(
          companySubscription.id,
        );
      if (initialPayment) {
        await this.repository.reconcileInitialPayment(initialPayment.id, {
          epaycoRef: dto.x_ref_payco,
          epaycoTransactionId: dto.x_transaction_id,
          franchise: dto.x_franchise,
          approvalCode: dto.x_approval_code,
        });
        this.logger.log(
          `Pago inicial de onboarding conciliado para suscripción ${companySubscription.id} (ref=${dto.x_ref_payco})`,
        );
        return { received: true };
      }

      // Cobro exitoso (renovación) → extender período
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

      // Notificar al cliente (admin + facturación) el motivo del rechazo.
      try {
        const { to, userName } = await this.resolveNotificationRecipients(
          companySubscription.companyId,
          companySubscription.company.billingEmail,
          companySubscription.company.billingName,
          companySubscription.company.billingLastName,
        );
        await this.mailService.sendPaymentFailedEmail({
          to,
          userName,
          companyName: companySubscription.company.name,
          planName: companySubscription.subscription.name,
          reason:
            dto.x_response ||
            'El banco rechazó el cobro recurrente de tu suscripción.',
        });
      } catch (error: any) {
        this.logger.warn(
          `Error enviando correo de pago rechazado (suscripción ${companySubscription.id}): ${error.message}`,
        );
      }
    } else if (responseCode === 3) {
      this.logger.log(
        `Suscripción ${companySubscription.id} pendiente de confirmación (ref=${dto.x_ref_payco})`,
      );
    }

    return { received: true };
  }
}
