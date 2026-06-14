import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CompanySubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    subscription: true,
    status: true,
    company: true,
  };

  async create(data: Prisma.CompanySubscriptionUncheckedCreateInput) {
    return this.prisma.companySubscription.create({
      data,
      include: this.defaultInclude,
    });
  }

  async update(
    id: string,
    data: Prisma.CompanySubscriptionUncheckedUpdateInput,
  ) {
    return this.prisma.companySubscription.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async companyExists(companyId: string): Promise<boolean> {
    const count = await this.prisma.company.count({ where: { id: companyId } });
    return count > 0;
  }

  async findSubscriptionById(subscriptionId: string) {
    return this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
  }

  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findUnique({
      where: { type_code: { type, code } },
    });
  }

  async findActiveSubscriptionByCompanyId(
    companyId: string,
    activeStatusId: number,
  ) {
    return this.prisma.companySubscription.findFirst({
      where: { companyId, statusId: activeStatusId },
      include: this.defaultInclude,
    });
  }

  async findPendingByCompanyId(companyId: string, pendingStatusId: number) {
    return this.prisma.companySubscription.findFirst({
      where: { companyId, statusId: pendingStatusId },
      orderBy: { createdAt: 'desc' },
      include: this.defaultInclude,
    });
  }

  async findCompanyById(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      include: { billingDocType: true },
    });
  }

  /** CompanySubscription con empresa, plan, estado y precio de consulta. */
  async findByIdWithDetails(id: string) {
    return this.prisma.companySubscription.findUnique({
      where: { id },
      include: {
        company: true,
        subscription: true,
        status: true,
        consultationPrice: true,
      },
    });
  }

  /**
   * Reclama el pago de forma atómica: consume el paymentToken sólo si coincide y
   * sigue presente. Devuelve true si este request ganó el claim, false si otro
   * request concurrente ya lo tomó (evita doble cobro por doble clic/pestañas).
   */
  async claimPaymentToken(id: string, token: string): Promise<boolean> {
    const { count } = await this.prisma.companySubscription.updateMany({
      where: { id, paymentToken: token },
      data: { paymentToken: null },
    });
    return count === 1;
  }

  /**
   * Restaura el paymentToken si el pago no llegó a completarse (fallo en ePayco
   * o en el commit), para que el cliente pueda reintentar con el mismo link.
   * Sólo restaura si la suscripción sigue pendiente de pago (no activada).
   */
  async restorePaymentToken(
    id: string,
    token: string,
    pendingStatusId: number,
  ): Promise<void> {
    await this.prisma.companySubscription.updateMany({
      where: { id, paymentToken: null, statusId: pendingStatusId },
      data: { paymentToken: token },
    });
  }

  async updateCompanyBilling(
    companyId: string,
    data: {
      billingName: string;
      billingLastName: string;
      billingDocNumber: string;
      billingEmail: string;
      billingAddress: string;
      billingState: string;
      billingCity: string;
      billingPhone: string;
      billingDocTypeId: number;
    },
  ) {
    return this.prisma.company.update({
      where: { id: companyId },
      data,
    });
  }

  async findCompanyAdmin(companyId: string, adminRoleId: number) {
    const userCompany = await this.prisma.userCompany.findFirst({
      where: { companyId, roleId: adminRoleId, isActive: true },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    return userCompany?.user ?? null;
  }

  /**
   * Suscripciones vigentes cuyo periodo ya terminó (endDate < límite) y que
   * siguen en el estado "activo" dado. El límite debe ser el inicio del día de
   * hoy (medianoche local), de modo que una suscripción que vence HOY no se
   * incluya hasta el día siguiente (el cliente conserva acceso todo el día).
   */
  async findOverdueActive(activeStatusId: number, before: Date) {
    return this.prisma.companySubscription.findMany({
      where: {
        statusId: activeStatusId,
        isCurrent: true,
        endDate: { lt: before },
      },
      include: { company: true, subscription: true },
    });
  }

  async findActiveByBillingDoc(billingDocNumber: string) {
    return this.prisma.companySubscription.findFirst({
      where: {
        isCurrent: true,
        autoRenew: true,
        company: { billingDocNumber },
      },
      include: this.defaultInclude,
    });
  }

  async countActiveUsers(companyId: string): Promise<number> {
    return this.prisma.userCompany.count({
      where: { companyId, isActive: true },
    });
  }

  async countCustomers(companyId: string): Promise<number> {
    return this.prisma.customer.count({ where: { companyId } });
  }

  async setCompanyEpaycoCustomerId(
    companyId: string,
    epaycoCustomerId: string,
  ) {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { epaycoCustomerId },
    });
  }

  async replaceCurrentSubscription(params: {
    currentSubscriptionId: string;
    cancelledStatusId: number;
    newData: Prisma.CompanySubscriptionUncheckedCreateInput;
    firstPayment: Omit<
      Prisma.PaymentHistoryUncheckedCreateInput,
      'companySubscriptionId'
    >;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.companySubscription.update({
        where: { id: params.currentSubscriptionId },
        data: {
          statusId: params.cancelledStatusId,
          isCurrent: false,
          autoRenew: false,
          cancelledAt: new Date(),
        },
      });

      const created = await tx.companySubscription.create({
        data: params.newData,
        include: this.defaultInclude,
      });

      await tx.paymentHistory.create({
        data: {
          ...params.firstPayment,
          companySubscriptionId: created.id,
        },
      });

      return created;
    });
  }

  /**
   * Activa una suscripción tras el pago de onboarding y registra el primer pago
   * en una única transacción. Si falla, no deja la suscripción medio-activada.
   */
  async activateAfterPayment(params: {
    companySubscriptionId: string;
    activeStatusId: number;
    epaycoPlanId: string;
    epaycoSubscriptionId: string;
    firstPayment: Omit<
      Prisma.PaymentHistoryUncheckedCreateInput,
      'companySubscriptionId'
    >;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.companySubscription.update({
        where: { id: params.companySubscriptionId },
        data: {
          statusId: params.activeStatusId,
          epaycoPlanId: params.epaycoPlanId,
          epaycoSubscriptionId: params.epaycoSubscriptionId,
          autoRenew: true,
          paymentToken: null, // invalida el link una vez pagado
        },
        include: this.defaultInclude,
      });

      await tx.paymentHistory.create({
        data: {
          ...params.firstPayment,
          companySubscriptionId: params.companySubscriptionId,
        },
      });

      return updated;
    });
  }

  // ─── PaymentHistory ─────────────────────────────────────────

  async createPaymentHistory(data: Prisma.PaymentHistoryUncheckedCreateInput) {
    return this.prisma.paymentHistory.create({ data });
  }

  async paymentExistsByTransactionId(epaycoTransactionId: string) {
    const count = await this.prisma.paymentHistory.count({
      where: { epaycoTransactionId },
    });
    return count > 0;
  }

  /**
   * El pago inicial de onboarding se registra en payOnboarding SIN
   * epaycoTransactionId (aún no hay webhook). Devuelve ese registro pendiente
   * de conciliar, si existe, para el primer cobro que llegue por webhook.
   */
  async findUnreconciledInitialPayment(companySubscriptionId: string) {
    return this.prisma.paymentHistory.findFirst({
      where: { companySubscriptionId, epaycoTransactionId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Adjunta los datos del webhook al pago inicial (lo concilia). */
  async reconcileInitialPayment(
    paymentHistoryId: string,
    data: {
      epaycoRef?: string;
      epaycoTransactionId?: string;
      franchise?: string;
      approvalCode?: string;
    },
  ) {
    return this.prisma.paymentHistory.update({
      where: { id: paymentHistoryId },
      data,
    });
  }
}
