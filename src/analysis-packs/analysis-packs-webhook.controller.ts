import {
  Controller,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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
  handleConfirmation(
    @Body() body: PackConfirmationDto,
    @Query() query: PackConfirmationDto,
  ) {
    // ePayco puede enviar la confirmación como body (form-urlencoded, checkout
    // onepage) o como query params según el mecanismo. Tomamos lo que venga
    // poblado (el body tiene prioridad).
    const dto =
      body && Object.keys(body).length > 0 ? body : query;
    return this.service.handleConfirmation(dto);
  }
}
