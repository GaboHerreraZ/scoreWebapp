import { Controller, Post, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { SubscribeDto } from './dto/subscribe.dto.js';
import { SubscribeFreeDto } from './dto/subscribe-free.dto.js';

@ApiTags('Company Subscriptions')
@ApiBearerAuth()
@Controller('companies/:companyId/subscriptions')
export class CompanySubscriptionsController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @Post('subscribe-free')
  @ApiOperation({
    summary: 'Subscribe a company to a free plan (no payment required)',
  })
  @ApiResponse({
    status: 201,
    description: 'Free subscription created successfully',
  })
  @ApiResponse({ status: 400, description: 'Plan is not free' })
  @ApiResponse({
    status: 409,
    description: 'Company already has an active subscription',
  })
  subscribeFree(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SubscribeFreeDto,
  ) {
    return this.companySubscriptionsService.subscribeFree(companyId, dto);
  }

  @Post('cancel')
  @ApiOperation({
    summary: 'Cancel the current subscription and fall back to the free plan',
  })
  @ApiResponse({ status: 201, description: 'Subscription cancelled and free plan activated' })
  @ApiResponse({ status: 404, description: 'Company or active subscription not found' })
  cancel(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companySubscriptionsService.cancel(companyId);
  }

  @Post('subscribe')
  @ApiOperation({
    summary: 'Subscribe a company to a plan via ePayco recurring billing',
  })
  @ApiResponse({ status: 201, description: 'Subscription created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Missing billing data or ePayco plan not configured',
  })
  @ApiResponse({
    status: 404,
    description: 'Company or subscription plan not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Company already has an active subscription',
  })
  subscribe(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.companySubscriptionsService.subscribe(companyId, dto);
  }
}
