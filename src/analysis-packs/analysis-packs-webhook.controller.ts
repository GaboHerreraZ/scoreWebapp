import { Controller, Post, Req, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { AnalysisPacksService } from './analysis-packs.service.js';
import { PackConfirmationDto } from './dto/pack-confirmation.dto.js';

@ApiTags('ePayco Webhook (Packs)')
@Controller('webhooks/epayco/packs')
export class AnalysisPacksWebhookController {
  constructor(private readonly service: AnalysisPacksService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmación de pago de compra de pack (ePayco)' })
  @ApiResponse({ status: 200, description: 'Confirmación procesada' })
  @ApiResponse({ status: 400, description: 'Firma o datos inválidos' })
  @ApiResponse({ status: 404, description: 'Bolsa no encontrada' })
  handleConfirmation(@Req() req: Request) {
    // ePayco envía DECENAS de campos x_* (cust_id, bank_name, customer_*, etc.)
    // que no declaramos. NO usamos @Body()/@Query() con DTO porque el
    // ValidationPipe global (forbidNonWhitelisted) rechazaría esos campos con
    // 400 → la bolsa nunca se activaría aunque el pago se cobró. Para un webhook
    // de tercero el payload no se valida: se lee crudo y se ignoran los extras.
    // ePayco puede mandarlo como body (form-urlencoded) o como query params;
    // tomamos lo que venga poblado (body primero).
    const raw =
      req.body && Object.keys(req.body).length > 0 ? req.body : req.query;
    const dto = raw as unknown as PackConfirmationDto;
    return this.service.handleConfirmation(dto);
  }
}
