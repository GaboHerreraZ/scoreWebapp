import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator.js';

/**
 * Liveness probe para orquestadores y monitoreo externo (GET /api/health).
 * SIN dependencia de la base de datos a propósito: un microcorte de Postgres
 * no debe hacer que el orquestador reinicie el proceso de la API.
 */
@ApiExcludeController()
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
