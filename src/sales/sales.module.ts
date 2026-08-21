import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { SalesCommissionsService } from './sales-commissions.service.js';
import { SalesRepository } from './sales.repository.js';

/**
 * Programa de referidos. Exporta:
 *  - SalesCommissionsService: la causación la dispara el webhook de pago.
 *  - SalesService: el onboarding resuelve el código que escribe el cliente.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SalesController],
  providers: [SalesService, SalesCommissionsService, SalesRepository],
  exports: [SalesCommissionsService, SalesService],
})
export class SalesModule {}
