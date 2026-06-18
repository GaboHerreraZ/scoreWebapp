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
