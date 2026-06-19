import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentAlertsService } from './payment-alerts.service.js';
import { FilterPaymentAlertDto } from './dto/filter-payment-alert.dto.js';
import { UpdatePaymentAlertDto } from './dto/update-payment-alert.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

@ApiTags('Payment Alerts (Admin)')
@AdminOnly()
@Controller('payment-alerts')
export class PaymentAlertsController {
  constructor(private readonly service: PaymentAlertsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar alertas de pago (panel admin), paginado y filtrable',
  })
  @ApiResponse({ status: 200, description: 'data + meta de paginación' })
  findAll(@Query() filters: FilterPaymentAlertDto) {
    return this.service.findAll(filters);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Gestionar una alerta (estado y/o notas)' })
  @ApiResponse({ status: 200, description: 'Alerta actualizada' })
  @ApiResponse({ status: 404, description: 'Alerta no encontrada' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentAlertDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.updateStatus(id, dto, userId);
  }
}
