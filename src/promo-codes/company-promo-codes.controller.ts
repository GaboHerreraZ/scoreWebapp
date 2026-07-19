import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { PromoCodesService } from './promo-codes.service.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

/**
 * Validación de un código promocional para una empresa, ANTES de comprar. El
 * front la usa para mostrar el descuento; no canjea el código (eso ocurre al
 * confirmarse el pago en el webhook). Company-scoped: valida acceso a la empresa.
 */
@ApiTags('Promo Codes (Company)')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/promo-codes')
export class CompanyPromoCodesController {
  constructor(private readonly service: PromoCodesService) {}

  @Get('validate')
  @ApiOperation({
    summary: 'Validar un código para esta empresa (sin canjear)',
  })
  @ApiResponse({
    status: 200,
    description: '{ valid, reason?, code?, discountPercent? }',
  })
  validate(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('code') code: string,
  ) {
    return this.service.validateForPurchase(code ?? '', companyId);
  }
}
