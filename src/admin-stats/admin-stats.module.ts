import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminStatsController } from './admin-stats.controller.js';
import { AdminStatsService } from './admin-stats.service.js';
import { AdminStatsRepository } from './admin-stats.repository.js';

@Module({
  // Caché en memoria del proceso para las estadísticas agregadas (TTL por
  // endpoint vía @CacheTTL). Suficiente para un panel admin de bajo tráfico;
  // si más adelante se escala a varias instancias, se cambia el store a Redis.
  imports: [PrismaModule, CacheModule.register()],
  controllers: [AdminStatsController],
  providers: [AdminStatsService, AdminStatsRepository],
})
export class AdminStatsModule {}
