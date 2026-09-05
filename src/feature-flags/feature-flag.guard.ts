import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service.js';
import type { FeatureFlagCode } from './feature-flags.constants.js';

export const FEATURE_FLAG_KEY = 'featureFlag';

/** Exige el flag encendido; apagado → 403. Usar junto a FeatureFlagGuard. */
export const RequireFeature = (code: FeatureFlagCode) =>
  SetMetadata(FEATURE_FLAG_KEY, code);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<FeatureFlagCode | undefined>(
      FEATURE_FLAG_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!code) return true;
    if (await this.featureFlagsService.isEnabled(code)) return true;
    throw new ForbiddenException(
      'Esta funcionalidad no está disponible en este momento.',
    );
  }
}
