import {
  Controller,
  Get,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { EpaycoService } from './epayco.service.js';

@ApiTags('[TEMPORAL] ePayco Debug')
@Public()
@Controller('epayco')
export class EpaycoDebugController {
  constructor(private readonly epaycoService: EpaycoService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Listar planes en ePayco' })
  listPlans() {
    return this.epaycoService.listPlans();
  }

  @Get('customers')
  @ApiOperation({ summary: 'Listar clientes en ePayco' })
  listCustomers() {
    return this.epaycoService.listCustomers();
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Listar suscripciones en ePayco' })
  listSubscriptions() {
    return this.epaycoService.listSubscriptions();
  }

  @Delete('subscriptions/:subscriptionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar suscripción en ePayco' })
  deleteSubscription(@Param('subscriptionId') subscriptionId: string) {
    return this.epaycoService.cancelSubscription(subscriptionId);
  }

  @Delete('customers/:customerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar cliente en ePayco' })
  deleteCustomer(@Param('customerId') customerId: string) {
    return this.epaycoService.deleteCustomer(customerId);
  }
}
