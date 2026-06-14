import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { PayOnboardingDto } from './dto/pay-onboarding.dto.js';

/**
 * Flujo público de pago del onboarding. El cliente llega desde el link del
 * correo (companySubscriptionId + token) sin estar autenticado: ve el resumen
 * y paga su suscripción recurrente desde la página de checkout propia.
 */
@ApiTags('Onboarding Payment')
@Controller('onboarding-payment')
export class OnboardingPaymentController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @Get('summary')
  @Public()
  @ApiOperation({
    summary: 'Resumen de la suscripción a pagar (para la página de checkout)',
  })
  @ApiResponse({ status: 200, description: 'Resumen del pago' })
  @ApiResponse({
    status: 404,
    description: 'Enlace de pago inválido o expirado',
  })
  getSummary(
    @Query('companySubscriptionId') companySubscriptionId: string,
    @Query('token') token: string,
  ) {
    return this.companySubscriptionsService.getPaymentSummary(
      companySubscriptionId,
      token,
    );
  }

  @Post('pay')
  @Public()
  @ApiOperation({
    summary: 'Procesa el pago inicial y crea la suscripción recurrente',
  })
  @ApiResponse({
    status: 201,
    description: 'Pago procesado, suscripción activa',
  })
  @ApiResponse({
    status: 404,
    description: 'Enlace de pago inválido o expirado',
  })
  @ApiResponse({ status: 409, description: 'La suscripción ya fue pagada' })
  pay(@Body() dto: PayOnboardingDto) {
    return this.companySubscriptionsService.payOnboarding(dto);
  }
}
