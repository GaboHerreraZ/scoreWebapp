import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Verifies that incoming DocuSeal webhook requests include the expected
 * custom header `X-Webhook-Secret` matching the value stored in
 * `DOCUSEAL_WEBHOOK_SECRET`.
 *
 * DocuSeal lets you configure arbitrary key-value headers that are sent
 * with every outbound webhook. We use this to authenticate requests.
 *
 * When the env var is empty the guard lets requests through with a warning
 * so local development is not blocked.
 */
@Injectable()
export class DocuSealWebhookGuard implements CanActivate {
  private readonly logger = new Logger(DocuSealWebhookGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.configService.get<string>('DOCUSEAL_WEBHOOK_SECRET');

    if (!secret) {
      this.logger.warn(
        'DOCUSEAL_WEBHOOK_SECRET no está configurado — la verificación del webhook está DESACTIVADA',
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers['x-webhook-secret'] as
      | string
      | undefined;

    if (!headerValue) {
      throw new UnauthorizedException(
        'Falta el header X-Webhook-Secret en la solicitud del webhook.',
      );
    }

    const expected = Buffer.from(secret, 'utf8');
    const received = Buffer.from(headerValue, 'utf8');

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException(
        'El header X-Webhook-Secret no coincide.',
      );
    }

    return true;
  }
}
