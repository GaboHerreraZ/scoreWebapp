import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ¿El proceso corre contra el entorno de STAGING? Se lee de APP_ENV y, si no
 * está, de SENTRY_ENV (ya vale 'staging' en .env.staging y 'production' en
 * .env/.env.pro). Falla CERRADO: sin variable, no es staging.
 */
export function isStagingEnv(configService: ConfigService): boolean {
  const env =
    configService.get<string>('APP_ENV') ??
    configService.get<string>('SENTRY_ENV') ??
    '';
  return env.trim().toLowerCase() === 'staging';
}

/**
 * Restringe un endpoint al entorno de staging. Fuera de él responde 404 (no
 * 403): la ruta no debe siquiera existir en producción. Se usa junto con
 * AdminGuard, nunca solo.
 */
@Injectable()
export class StagingOnlyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    if (!isStagingEnv(this.configService)) {
      throw new NotFoundException('Cannot resolve route');
    }
    return true;
  }
}
