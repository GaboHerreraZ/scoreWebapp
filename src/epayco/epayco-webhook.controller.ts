import { Controller, Post, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CompanySubscriptionsService } from '../company-subscriptions/company-subscriptions.service.js';
import { EpaycoConfirmationDto } from '../company-subscriptions/dto/epayco-confirmation.dto.js';

@ApiTags('ePayco Webhook')
@Controller('webhooks/epayco')
export class EpaycoWebhookController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle ePayco recurring payment confirmation' })
  @ApiResponse({ status: 200, description: 'Confirmation processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature or data' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  handleConfirmation(@Query() dto: EpaycoConfirmationDto) {
    return this.companySubscriptionsService.handleEpaycoConfirmation(dto);
  }
}
