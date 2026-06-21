import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdminStatsService } from './admin-stats.service.js';
import { StatsPeriodDto } from './dto/stats-period.dto.js';
import { StatsRankingDto } from './dto/stats-ranking.dto.js';
import { ExpiringCreditsDto } from './dto/expiring-credits.dto.js';
import { MonthlyTrendDto } from './dto/monthly-trend.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

/** TTL de caché para los endpoints pesados: 10 minutos (en ms). */
const STATS_TTL = 10 * 60 * 1000;

/**
 * Estadísticas del portal de administración. Todos read-only y @AdminOnly.
 * Los endpoints agregados llevan CacheInterceptor (cachea por URL completa, así
 * que cada combinación de from/to/page/limit se cachea por separado). El de
 * "saldo por vencer" no se cachea (debe reflejar el estado al día).
 */
@ApiTags('Admin Stats')
@AdminOnly()
@Controller('admin/stats')
export class AdminStatsController {
  constructor(private readonly service: AdminStatsService) {}

  @Get('overview')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(STATS_TTL)
  @ApiOperation({
    summary: 'Resumen del periodo (ventas, consumo) + comparación con el anterior',
  })
  @ApiResponse({ status: 200, description: 'period, sales, usage, previous, deltas' })
  overview(@Query() dto: StatsPeriodDto) {
    return this.service.getOverview(dto);
  }

  @Get('top-consumers')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(STATS_TTL)
  @ApiOperation({ summary: 'Top empresas por consumo (candidatas a promoción)' })
  @ApiResponse({ status: 200, description: 'data + meta + period' })
  topConsumers(@Query() dto: StatsRankingDto) {
    return this.service.getTopConsumers(dto);
  }

  @Get('inactive-clients')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(STATS_TTL)
  @ApiOperation({
    summary: 'Empresas que compraron y NO consumen en el periodo (riesgo churn)',
  })
  @ApiResponse({ status: 200, description: 'data + meta + period' })
  inactiveClients(@Query() dto: StatsRankingDto) {
    return this.service.getInactiveClients(dto);
  }

  @Get('utilization')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(STATS_TTL)
  @ApiOperation({ summary: 'Aprovechamiento por empresa (comprado vs consumido)' })
  @ApiResponse({ status: 200, description: 'data + meta + period' })
  utilization(@Query() dto: StatsRankingDto) {
    return this.service.getUtilization(dto);
  }

  @Get('expiring-credits')
  @ApiOperation({ summary: 'Empresas con saldo que vence pronto (sin caché)' })
  @ApiResponse({ status: 200, description: 'data + meta + windowDays' })
  expiringCredits(@Query() dto: ExpiringCreditsDto) {
    return this.service.getExpiringCredits(dto);
  }

  @Get('monthly-trend')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(STATS_TTL)
  @ApiOperation({ summary: 'Consultas consumidas por mes (serie temporal)' })
  @ApiResponse({ status: 200, description: 'months + data[{ month, consumed }]' })
  monthlyTrend(@Query() dto: MonthlyTrendDto) {
    return this.service.getMonthlyTrend(dto.months);
  }

  @Get('promo-usage')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(STATS_TTL)
  @ApiOperation({ summary: 'Uso de códigos promocionales (canjes y descuento)' })
  @ApiResponse({ status: 200, description: 'data + meta + period' })
  promoUsage(@Query() dto: StatsRankingDto) {
    return this.service.getPromoUsage(dto);
  }
}
