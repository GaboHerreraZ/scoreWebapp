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
 * Protege los endpoints de jobs (cron) verificando que la solicitud incluya el
 * header `X-Cron-Secret` igual al valor de `CRON_SECRET`. Lo dispara un cron
 * externo (Railway Cron) que no tiene sesión de usuario, por eso no usa el auth
 * normal. Si `CRON_SECRET` no está configurado, BLOQUEA (a diferencia de otros
 * guards de dev): un job que desactiva suscripciones no debe quedar abierto.
 */
@Injectable()
export class CronGuard implements CanActivate {
  private readonly logger = new Logger(CronGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.configService.get<string>('CRON_SECRET');

    if (!secret) {
      this.logger.error(
        'CRON_SECRET no está configurado — el endpoint de jobs queda bloqueado',
      );
      throw new UnauthorizedException('Jobs no habilitados en este entorno.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers['x-cron-secret'] as string | undefined;

    if (!headerValue) {
      throw new UnauthorizedException('Falta el header X-Cron-Secret.');
    }

    const expected = Buffer.from(secret, 'utf8');
    const received = Buffer.from(headerValue, 'utf8');

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('El header X-Cron-Secret no coincide.');
    }

    return true;
  }
}
