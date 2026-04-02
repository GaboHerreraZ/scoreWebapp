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

  constructor(private readonly configService: ConfigService) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
    const __dirname = dirname(fileURLToPath(import.meta.url));
    this.templatesDir = join(__dirname, '..', '..', 'mail', 'templates');
  }

  private loadTemplate(templateName: string, variables: Record<string, string>): string {
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
    const invitationUrl = `http://localhost:4200/invitacion?email=${encodeURIComponent(to)}&invitationId=${invitationId}&token=${token}`;

    const html = this.loadTemplate('invitation', {
      invitedByName,
      companyName,
      invitationUrl,
    });

    await this.resend.emails.send({
      from: 'TuPlazo <onboarding@resend.dev>',
      to,
      subject: `${invitedByName} te ha invitado a colaborar en ${companyName}`,
      html,
    });
  }

  async sendUserDeactivatedEmail(params: {
    to: string;
    companyName: string;
  }) {
    const { to, companyName } = params;

    const html = this.loadTemplate('user-deactivated', { companyName });

    await this.resend.emails.send({
      from: 'TuPlazo <onboarding@resend.dev>',
      to,
      subject: `Tu acceso a ${companyName} ha sido desactivado`,
      html,
    });
  }
}
