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

  /**
   * Avisa a un admin de una venta cobrada, con los datos fiscales del comprador
   * y el desglose base/IVA que necesita la factura electrónica.
   */
  async sendPurchasePaidAdminEmail(params: {
    to: string;
    companyName: string;
    billingName: string;
    billingDocNumber: string;
    billingEmail: string;
    billingAddress: string;
    billingCity: string;
    planName: string;
    quantity: string;
    taxBase: string;
    taxRate: string;
    taxAmount: string;
    total: string;
    currency: string;
    providerReference: string;
    paidAt: string;
    isTest: string;
  }) {
    const { to, ...vars } = params;

    const html = this.loadTemplate('purchase-paid-admin', {
      ...vars,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Venta cobrada — ${params.billingName} (${params.total} ${params.currency})`,
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
    providerReference: string;
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
      providerReference,
      actionNote,
    } = params;

    const html = this.loadTemplate('payment-reversed-admin', {
      companyName,
      planName,
      amount,
      currency,
      consumed,
      quantity,
      providerReference,
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

  /** Confirmación al cliente de que su ticket de soporte fue registrado. */
  async sendSupportTicketClientEmail(params: {
    to: string;
    fullName: string;
    reference: string;
    subject: string;
    areaLabel: string;
  }) {
    const { to, fullName, reference, subject, areaLabel } = params;

    const html = this.loadTemplate('support-ticket-client', {
      fullName,
      reference,
      subject,
      areaLabel,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Recibimos tu solicitud de soporte (${reference})`,
      html,
    });
  }

  /** Aviso a los admins de un nuevo ticket de soporte. */
  async sendSupportTicketAdminEmail(params: {
    to: string;
    reference: string;
    companyName: string;
    areaLabel: string;
    subject: string;
    description: string;
  }) {
    const { to, reference, companyName, areaLabel, subject, description } =
      params;

    const html = this.loadTemplate('support-ticket-admin', {
      reference,
      companyName,
      areaLabel,
      subject,
      description,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Nuevo ticket de soporte ${reference} — ${companyName}`,
      html,
    });
  }

  /** Aviso al admin del portal al que se le ASIGNÓ un ticket (le toca atenderlo). */
  async sendSupportTicketAssignedEmail(params: {
    to: string;
    adminName: string;
    reference: string;
    companyName: string;
    areaLabel: string;
    priorityLabel: string;
    subject: string;
    description: string;
  }) {
    const {
      to,
      adminName,
      reference,
      companyName,
      areaLabel,
      priorityLabel,
      subject,
      description,
    } = params;

    const html = this.loadTemplate('support-ticket-assigned', {
      adminName,
      reference,
      companyName,
      areaLabel,
      priorityLabel,
      subject,
      description,
      logoUrl: this.logoUrl,
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Se te asignó el ticket ${reference} — ${companyName}`,
      html,
    });
  }
}
