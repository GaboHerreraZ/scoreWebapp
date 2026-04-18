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

  constructor(private readonly configService: ConfigService) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
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
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `${invitedByName} te ha invitado a colaborar en ${companyName}`,
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
    });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Tu suscripción a ${planName} ha sido cancelada`,
      html,
    });
  }

  async sendUserDeactivatedEmail(params: { to: string; companyName: string }) {
    const { to, companyName } = params;

    const html = this.loadTemplate('user-deactivated', { companyName });

    await this.resend.emails.send({
      from: 'Creditia <notificaciones@creditia.co>',
      to,
      subject: `Tu acceso a ${companyName} ha sido desactivado`,
      html,
    });
  }
}
