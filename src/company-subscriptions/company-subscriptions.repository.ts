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

  async findParameterById(id: number) {
    return this.prisma.parameter.findUnique({ where: { id } });
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
   * Guarda los IDs de ePayco en la suscripción de onboarding SIN activarla: queda
   * en pending_payment hasta que el webhook confirme el primer cobro. Así nunca
   * hay acceso sin cobro confirmado. No crea payment history (lo crea el webhook
   * al activar).
   */
  async saveEpaycoIdsPending(params: {
    companySubscriptionId: string;
    epaycoPlanId: string;
    epaycoSubscriptionId: string;
  }) {
    return this.prisma.companySubscription.update({
      where: { id: params.companySubscriptionId },
      data: {
        epaycoPlanId: params.epaycoPlanId,
        epaycoSubscriptionId: params.epaycoSubscriptionId,
        autoRenew: true,
      },
      include: this.defaultInclude,
    });
  }

  /**
   * Activa una suscripción tras confirmarse el primer cobro por webhook y registra
   * el pago inicial, en una única transacción. Idempotente vía el guard de estado:
   * solo activa si sigue en pending_payment.
   */
  async activateAfterConfirmation(params: {
    companySubscriptionId: string;
    pendingStatusId: number;
    activeStatusId: number;
    firstPayment: Omit<
      Prisma.PaymentHistoryUncheckedCreateInput,
      'companySubscriptionId'
    >;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Guard atómico: solo activa si aún está pendiente. Si dos webhooks llegan
      // a la vez, solo el primero pasa de pending→active y crea el pago.
      const { count } = await tx.companySubscription.updateMany({
        where: {
          id: params.companySubscriptionId,
          statusId: params.pendingStatusId,
        },
        data: { statusId: params.activeStatusId, paymentToken: null },
      });
      if (count !== 1) return false;

      await tx.paymentHistory.create({
        data: {
          ...params.firstPayment,
          companySubscriptionId: params.companySubscriptionId,
        },
      });
      return true;
    });
  }

  /**
   * Prepara una suscripción de onboarding para reintento tras un cobro inicial
   * rechazado: emite un paymentToken nuevo (link nuevo) y limpia los IDs de la
   * suscripción ePayco cancelada, manteniéndola en pending_payment. El cliente
   * reingresa una tarjeta nueva con el link y payOnboarding crea una suscripción
   * ePayco limpia (sin duplicar la anterior, que ya se canceló).
   */
  async resetForRetry(id: string, newPaymentToken: string) {
    return this.prisma.companySubscription.update({
      where: { id },
      data: {
        paymentToken: newPaymentToken,
        epaycoSubscriptionId: null,
        epaycoPlanId: null,
      },
      include: this.defaultInclude,
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
}
