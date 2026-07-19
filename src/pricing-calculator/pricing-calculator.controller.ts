import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PricingCalculatorService } from './pricing-calculator.service.js';
import { SimulatePricingDto } from './dto/simulate-pricing.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

@ApiTags('Pricing Calculator')
@ApiBearerAuth()
@AdminOnly()
@Controller('pricing-calculator')
export class PricingCalculatorController {
  constructor(private readonly service: PricingCalculatorService) {}

  @Post('volume-discounts')
  @ApiOperation({
    summary:
      'Genera tramos de descuento por volumen a partir de precio, costo variable, margen mínimo y costos fijos',
  })
  @ApiResponse({ status: 201, description: 'Simulación calculada' })
  @ApiResponse({
    status: 400,
    description: 'El costo variable iguala o supera el precio (sin margen)',
  })
  simulate(@Body() dto: SimulatePricingDto) {
    return this.service.simulate(dto);
  }
}
