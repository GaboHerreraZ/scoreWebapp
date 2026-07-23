import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
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
      'Genera el menú de bolsas de consultas con precio unitario decreciente. El precio base es el precio de consulta activo; la curva se elige con "technique" (exponential | power | linear).',
  })
  @ApiResponse({ status: 201, description: 'Menú de bolsas calculado' })
  @ApiResponse({
    status: 400,
    description: 'El piso es mayor o igual al precio activo',
  })
  @ApiResponse({
    status: 409,
    description: 'No hay precio de consulta activo en el sistema',
  })
  simulate(@Body() dto: SimulatePricingDto) {
    return this.service.simulate(dto);
  }
}
