import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { WompiEventDto } from './dto/wompi-event.dto.js';

@ApiTags('Wompi Webhook')
@Controller('webhooks/wompi')
export class WompiWebhookController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Handle Wompi payment events' })
  @ApiResponse({ status: 200, description: 'Event processed' })
  @ApiResponse({ status: 400, description: 'Invalid checksum' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  handleEvent(@Body() event: WompiEventDto) {
    return this.companySubscriptionsService.handleWompiEvent(event);
  }
}
