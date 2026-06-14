import { Controller, Post, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { CreateConsultationPriceDto } from '../consultation-prices/dto/create-consultation-price.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

/**
 * Orquesta la creación de un precio de consulta junto con la recreación del
 * catálogo de planes. Vive en SubscriptionsModule (no en ConsultationPricesModule)
 * porque necesita SubscriptionsService; así la dependencia entre módulos fluye en
 * una sola dirección (subscriptions → consultation-prices) y no hace falta forwardRef.
 *
 * Expone POST /subscription-pricing: crear un precio es, en la práctica, versionar
 * el catálogo de planes, por eso la ruta pertenece al dominio de subscriptions.
 */
@ApiTags('Subscription Pricing')
@ApiBearerAuth()
@AdminOnly()
@Controller('subscription-pricing')
export class SubscriptionPricingController {
  constructor(
    private readonly consultationPricesService: ConsultationPricesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a consultation price and resync the plan catalog (admin only)',
  })
  @ApiResponse({ status: 201, description: 'Consultation price created' })
  async create(@Body() dto: CreateConsultationPriceDto, @Req() req: Request) {
    const userId = (req as any).user.id as string;

    // Cadena: 1) crear el precio; si entra vigente, 2) recrear el catálogo de
    // planes con el nuevo valor (planes ePayco con nuevo id_plan, dinámicos en BD;
    // los viejos pasan a isCurrent=false sin cancelarse en ePayco).
    const price = await this.consultationPricesService.create(dto, userId);

    if (dto.isActive !== false) {
      await this.subscriptionsService.resyncPlansForNewPrice(
        dto.unitPrice,
        price.createdBy,
      );
    }

    return price;
  }
}
