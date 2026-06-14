import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { formatCOP } from '../common/utils/currency.js';

@Injectable()
export class MailService {
  private readonly resend: Resend;
  private readonly templatesDir: string;

  private readonly frontendUrl: string;
  private readonly logoUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    // URL pública absoluta del logo (los clientes de correo no renderizan
    // archivos locales). Configurable vía LOGO_URL.
    this.logoUrl =
      this.configService.get<string>('LOGO_URL') ||
      'https://bjawxcnsjjobweucxfpf.supabase.co/storage/v1/object/public/general/creditia-logo.png';
    const __dirname = dirname(fileURLToPath(import.meta.url));
    this.templatesDir = join(__dirname, '..', '..', 'mail', 'templates');
  }

  private loadTemplate(
    templateName: string,
    variables: Record<string, string>,
  ): string {
    const filePath = join(this.templatesDir, `${templateName}.html`);
    let html = readFileSync(filePath, 'utf-8');

    for (const [key, value] of Object.entries(variables)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }

    return html;
  }

  async sendInvitationEmail(params: {
    to: string;
    invitationId: string;
    token: string;
    companyName: string;
    invitedByName: string;
  }) {
    const { to, invitationId, token, companyName, invitedByName } = params;
    const invitationUrl = `${this.frontendUrl}/invitacion?email=${encodeURIComponent(to)}&invitationId=${invitationId}&token=${token}`;

    const html = this.loadTemplate('invitation', {
      invitedByName,
      companyName,
      invitationUrl,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `${invitedByName} te ha invitado a colaborar en ${companyName}`,
      html,
    });
  }

  /**
   * Correo de bienvenida al dueño (owner) de una empresa recién dada de alta
   * desde el portal admin. Usa la MISMA URL de invitación que sendInvitationEmail
   * (mismo flujo de aceptación en el front), pero con un mensaje de bienvenida.
   */
  async sendOwnerWelcomeEmail(params: {
    to: string;
    invitationId: string;
    token: string;
    companyName: string;
    companySubscriptionId: string;
    paymentToken: string;
    planName: string;
    studiesPerMonth: number;
    maxUsers: number;
    amount: number;
    isMonthly: boolean;
  }) {
    const {
      to,
      invitationId,
      token,
      companyName,
      companySubscriptionId,
      paymentToken,
      planName,
      studiesPerMonth,
      maxUsers,
      amount,
      isMonthly,
    } = params;

    const invitationUrl = `${this.frontendUrl}/invitacion?email=${encodeURIComponent(to)}&invitationId=${invitationId}&token=${token}`;
    // Link a la página de checkout propia (resumen + formulario de tarjeta).
    const paymentUrl = `${this.frontendUrl}/pago-suscripcion?cs=${companySubscriptionId}&token=${paymentToken}`;

    const formattedAmount = formatCOP(amount);

    const html = this.loadTemplate('owner-welcome', {
      companyName,
      invitationUrl,
      paymentUrl,
      planName,
      studiesPerMonth: studiesPerMonth.toString(),
      maxUsers: maxUsers.toString(),
      amount: formattedAmount,
      billingCycle: isMonthly ? 'mensual' : 'anual',
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Bienvenido a Creditia — activa el acceso de ${companyName}`,
      html,
    });
  }

  async sendSubscriptionCancelledEmail(params: {
    to: string;
    userName: string;
    companyName: string;
    planName: string;
    maxUsers: number;
    maxCustomers: number | null;
    maxStudiesPerMonth: number | null;
    maxAiAnalysisPerMonth: number | null;
    maxPdfExtractionsPerMonth: number | null;
  }) {
    const {
      to,
      userName,
      companyName,
      planName,
      maxUsers,
      maxCustomers,
      maxStudiesPerMonth,
      maxAiAnalysisPerMonth,
      maxPdfExtractionsPerMonth,
    } = params;

    const formatLimit = (value: number | null) =>
      value === null ? 'Ilimitados' : value.toString();

    const html = this.loadTemplate('subscription-cancelled', {
      userName,
      companyName,
      planName,
      maxUsers: maxUsers.toString(),
      maxCustomers: formatLimit(maxCustomers),
      maxStudiesPerMonth: formatLimit(maxStudiesPerMonth),
      maxAiAnalysisPerMonth: formatLimit(maxAiAnalysisPerMonth),
      maxPdfExtractionsPerMonth: formatLimit(maxPdfExtractionsPerMonth),
      frontendUrl: this.frontendUrl,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Tu suscripción a ${planName} ha sido cancelada`,
      html,
    });
  }

  async sendPlanChangedEmail(params: {
    to: string;
    userName: string;
    newPlanName: string;
  }) {
    const { to, userName, newPlanName } = params;

    const html = this.loadTemplate('plan-changed', {
      userName,
      newPlanName,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Tu plan ha sido cambiado a ${newPlanName}`,
      html,
    });
  }

  /**
   * Avisa que el cobro recurrente de la suscripción falló, con el motivo
   * reportado por ePayco. Se envía al admin de la empresa y/o al correo de
   * facturación (los destinatarios ya vienen deduplicados).
   */
  async sendPaymentFailedEmail(params: {
    to: string[];
    userName: string;
    companyName: string;
    planName: string;
    reason: string;
  }) {
    const { to, userName, companyName, planName, reason } = params;
    if (to.length === 0) return;

    const html = this.loadTemplate('payment-failed', {
      userName,
      companyName,
      planName,
      reason,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `No pudimos procesar el pago de tu suscripción a ${planName}`,
      html,
    });
  }

  /**
   * Notifica que la suscripción venció sin pago y el acceso fue suspendido.
   * Se envía al admin de la empresa y/o al correo de facturación.
   */
  async sendSubscriptionExpiredEmail(params: {
    to: string[];
    userName: string;
    companyName: string;
    planName: string;
    endDate: Date;
  }) {
    const { to, userName, companyName, planName, endDate } = params;
    if (to.length === 0) return;

    const formattedDate = new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Bogota',
    }).format(endDate);

    const html = this.loadTemplate('subscription-expired', {
      userName,
      companyName,
      planName,
      endDate: formattedDate,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Tu suscripción a ${planName} ha vencido`,
      html,
    });
  }

  async sendUserDeactivatedEmail(params: { to: string; companyName: string }) {
    const { to, companyName } = params;

    const html = this.loadTemplate('user-deactivated', {
      companyName,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Tu acceso a ${companyName} ha sido desactivado`,
      html,
    });
  }
}
