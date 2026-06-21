import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

  /** Avisa al cliente que su pago fue reversado y debe pagar de nuevo. */
  async sendPaymentReversedClientEmail(params: {
    to: string;
    customerName: string;
    planName: string;
    quantity: string;
    amount: string;
    currency: string;
  }) {
    const { to, customerName, planName, quantity, amount, currency } = params;

    const html = this.loadTemplate('payment-reversed-client', {
      customerName,
      planName,
      quantity,
      amount,
      currency,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: 'Tu pago en Creditia fue reversado',
      html,
    });
  }

  /** Notifica a un admin del incidente de pago reversado. */
  async sendPaymentReversedAdminEmail(params: {
    to: string;
    companyName: string;
    planName: string;
    amount: string;
    currency: string;
    consumed: string;
    quantity: string;
    epaycoRef: string;
    actionNote: string;
  }) {
    const {
      to,
      companyName,
      planName,
      amount,
      currency,
      consumed,
      quantity,
      epaycoRef,
      actionNote,
    } = params;

    const html = this.loadTemplate('payment-reversed-admin', {
      companyName,
      planName,
      amount,
      currency,
      consumed,
      quantity,
      epaycoRef,
      actionNote,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Alerta: pago reversado — ${companyName}`,
      html,
    });
  }

  /** Aviso a los admins de un nuevo lead del formulario de contacto comercial. */
  async sendContactRequestAdminEmail(params: {
    to: string;
    subjectLabel: string;
    companyName: string;
    fullName: string;
    email: string;
    phone: string;
    message: string;
  }) {
    const { to, subjectLabel, companyName, fullName, email, phone, message } =
      params;

    const html = this.loadTemplate('contact-request-admin', {
      subjectLabel,
      companyName,
      fullName,
      email,
      phone,
      message,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Nuevo contacto comercial — ${companyName} (${subjectLabel})`,
      html,
    });
  }

  /** Confirmación al cliente de que recibimos su solicitud de contacto. */
  async sendContactRequestClientEmail(params: {
    to: string;
    fullName: string;
    companyName: string;
    subjectLabel: string;
    message: string;
  }) {
    const { to, fullName, companyName, subjectLabel, message } = params;

    const html = this.loadTemplate('contact-request-client', {
      fullName,
      companyName,
      subjectLabel,
      message,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: 'Recibimos tu mensaje — Creditia',
      html,
    });
  }
}
