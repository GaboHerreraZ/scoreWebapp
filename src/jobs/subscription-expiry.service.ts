import { Injectable, Logger } from '@nestjs/common';
import { CompanySubscriptionsRepository } from '../company-subscriptions/company-subscriptions.repository.js';
import { MailService } from '../mail/mail.service.js';

@Injectable()
export class SubscriptionExpiryService {
  private readonly logger = new Logger(SubscriptionExpiryService.name);

  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly mailService: MailService,
  ) {}

  /**
   * Inicio del día de HOY en hora de Colombia (America/Bogota, UTC-5),
   * expresado como instante UTC. Una suscripción con endDate < este límite ya
   * terminó ayer o antes; una que vence HOY (a cualquier hora) queda por encima
   * del límite y NO se expira hasta mañana → el cliente conserva acceso el día
   * de vencimiento. El servidor corre en UTC, por eso restamos el offset -5h.
   */
  private startOfTodayBogota(): Date {
    const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC-5
    const now = new Date();
    const bogotaNow = new Date(now.getTime() - COLOMBIA_OFFSET_MS);
    // Medianoche en Bogotá de la fecha actual de Bogotá.
    const bogotaMidnight = Date.UTC(
      bogotaNow.getUTCFullYear(),
      bogotaNow.getUTCMonth(),
      bogotaNow.getUTCDate(),
    );
    // Convertir esa medianoche local de vuelta a instante UTC.
    return new Date(bogotaMidnight + COLOMBIA_OFFSET_MS);
  }

  /**
   * Recolecta los destinatarios de notificación de una empresa: el admin activo
   * y el correo de facturación, deduplicados (case-insensitive). Devuelve también
   * un nombre legible para el saludo del correo.
   */
  private async resolveRecipients(
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

    const emails = new Map<string, true>(); // lower-case → presente
    const to: string[] = [];
    const push = (email?: string | null) => {
      if (!email) return;
      const key = email.toLowerCase();
      if (emails.has(key)) return;
      emails.set(key, true);
      to.push(email);
    };
    push(admin?.email);
    push(billingEmail);

    const userName = admin
      ? `${admin.name} ${admin.lastName ?? ''}`.trim()
      : `${billingName ?? ''} ${billingLastName ?? ''}`.trim() || 'cliente';

    return { to, userName };
  }

  /**
   * Expira las suscripciones cuyo periodo terminó antes del inicio del día de hoy
   * (hora Colombia) y notifica al cliente. Idempotente: solo toca suscripciones
   * que aún están en estado "active"/isCurrent, así que re-ejecutarlo el mismo
   * día no reprocesa lo ya expirado.
   */
  async expireOverdue() {
    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'active',
    );
    const expiredStatus = await this.repository.findParameterByTypeAndCode(
      'subscription_status',
      'expired',
    );
    if (!activeStatus || !expiredStatus) {
      this.logger.error(
        'Faltan parámetros subscription_status active/expired; no se ejecuta la expiración',
      );
      throw new Error('Parámetros de estado de suscripción no configurados');
    }

    const cutoff = this.startOfTodayBogota();
    const overdue = await this.repository.findOverdueActive(
      activeStatus.id,
      cutoff,
    );

    this.logger.log(
      `Expiración de suscripciones: ${overdue.length} vencidas antes de ${cutoff.toISOString()}`,
    );

    let expired = 0;
    let notified = 0;
    let errors = 0;

    for (const cs of overdue) {
      try {
        await this.repository.update(cs.id, {
          statusId: expiredStatus.id,
          isCurrent: false,
          autoRenew: false,
        });
        expired++;

        const { to, userName } = await this.resolveRecipients(
          cs.companyId,
          cs.company.billingEmail,
          cs.company.billingName,
          cs.company.billingLastName,
        );
        if (to.length > 0) {
          await this.mailService.sendSubscriptionExpiredEmail({
            to,
            userName,
            companyName: cs.company.name,
            planName: cs.subscription.name,
            endDate: cs.endDate,
          });
          notified++;
        }

        this.logger.log(
          `Suscripción ${cs.id} (empresa=${cs.companyId}) marcada como expirada`,
        );
      } catch (error: any) {
        errors++;
        this.logger.error(
          `Error expirando suscripción ${cs.id}: ${error.message}`,
        );
      }
    }

    return { processed: overdue.length, expired, notified, errors };
  }
}
