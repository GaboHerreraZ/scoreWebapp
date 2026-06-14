import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CronGuard } from './guards/cron.guard.js';
import { SubscriptionExpiryService } from './subscription-expiry.service.js';

@ApiTags('Jobs')
@Controller('jobs')
@Public()
@UseGuards(CronGuard)
@ApiHeader({
  name: 'X-Cron-Secret',
  description: 'Secreto compartido con el cron externo (CRON_SECRET)',
  required: true,
})
export class JobsController {
  constructor(
    private readonly subscriptionExpiryService: SubscriptionExpiryService,
  ) {}

  @Post('expire-subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Expira las suscripciones vencidas sin pago y notifica al cliente. Disparado por el cron diario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen del procesamiento (processed, expired, notified, errors)',
  })
  @ApiResponse({ status: 401, description: 'Header X-Cron-Secret inválido o ausente' })
  expireSubscriptions() {
    return this.subscriptionExpiryService.expireOverdue();
  }
}
