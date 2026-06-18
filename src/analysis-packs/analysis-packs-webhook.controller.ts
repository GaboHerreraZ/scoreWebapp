import {
  Controller,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { AnalysisPacksService } from './analysis-packs.service.js';
import { PackConfirmationDto } from './dto/pack-confirmation.dto.js';

// ePayco envía DECENAS de campos x_* (cust_id, bank_name, customer_*, etc.) que
// no declaramos en el DTO. La validación global usa forbidNonWhitelisted=true, lo
// que rechazaría la confirmación con 400 → la bolsa nunca se activaría aunque el
// pago se cobró. Para un webhook de terceros no controlamos el payload, así que
// aquí desactivamos whitelist/forbidNonWhitelisted: el DTO solo tipa lo que sí
// usamos y los campos extra simplemente se ignoran.
const webhookValidation = new ValidationPipe({
  whitelist: false,
  forbidNonWhitelisted: false,
  transform: true,
});

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
  handleConfirmation(
    @Body(webhookValidation) body: PackConfirmationDto,
    @Query(webhookValidation) query: PackConfirmationDto,
  ) {
    // ePayco puede enviar la confirmación como body (form-urlencoded) o como
    // query params según el mecanismo. Tomamos lo que venga poblado (el body
    // tiene prioridad).
    const dto = body && Object.keys(body).length > 0 ? body : query;
    return this.service.handleConfirmation(dto);
  }
}
