import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PromoCodesService } from './promo-codes.service.js';
import { PromoCodesRepository } from './promo-codes.repository.js';
import { PromoCodesController } from './promo-codes.controller.js';
import { CompanyPromoCodesController } from './company-promo-codes.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [PromoCodesController, CompanyPromoCodesController],
  providers: [PromoCodesService, PromoCodesRepository],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
