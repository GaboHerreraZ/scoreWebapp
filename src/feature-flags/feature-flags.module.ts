import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FeatureFlagsRepository } from './feature-flags.repository.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { FeatureFlagGuard } from './feature-flag.guard.js';
import { FeatureFlagsController } from './feature-flags.controller.js';
import { FeatureFlagsAdminController } from './feature-flags-admin.controller.js';

/** @Global: cualquier módulo usa el service o el guard sin importar este. */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FeatureFlagsController, FeatureFlagsAdminController],
  providers: [FeatureFlagsService, FeatureFlagsRepository, FeatureFlagGuard],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
