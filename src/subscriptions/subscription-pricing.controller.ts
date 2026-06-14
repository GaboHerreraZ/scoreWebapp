import { Controller, Post, Body, Req, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(SubscriptionPricingController.name);

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

    // Paso 1: crear el precio. Si esto falla, el error sí sube al cliente (no se
    // creó nada).
    const price = await this.consultationPricesService.create(dto, userId);

    // Paso 2: si el precio entra vigente, recrear el catálogo con el nuevo valor.
    // Blindado: el precio YA quedó creado, así que un fallo del resync no debe
    // invalidar la respuesta. Lo registramos y devolvemos resync.ok=false para
    // que el admin sepa que debe reintentar (recrear los planes), sin perder el
    // precio recién creado.
    let resync: {
      ok: boolean;
      recreated: number;
      skipped: number;
      error?: string;
    } = { ok: true, recreated: 0, skipped: 0 };

    if (dto.isActive !== false) {
      try {
        const result = await this.subscriptionsService.resyncPlansForNewPrice(
          dto.unitPrice,
          price.createdBy,
        );
        resync = { ok: true, ...result };
      } catch (error: any) {
        this.logger.error(
          `Precio ${price.id} creado, pero el resync del catálogo de planes falló: ${error?.message ?? error}`,
          error?.stack,
        );
        resync = {
          ok: false,
          recreated: 0,
          skipped: 0,
          error:
            'El precio se creó pero la recreación del catálogo de planes falló. Reintente la sincronización.',
        };
      }
    }

    return { ...price, resync };
  }
}
