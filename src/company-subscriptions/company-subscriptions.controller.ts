import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { CreateCompanySubscriptionDto } from './dto/create-company-subscription.dto.js';
import { UpdateCompanySubscriptionDto } from './dto/update-company-subscription.dto.js';
import { FilterCompanySubscriptionDto } from './dto/filter-company-subscription.dto.js';
import { SubscribeDto } from './dto/subscribe.dto.js';
import { SubscribeFreeDto } from './dto/subscribe-free.dto.js';

@ApiTags('Company Subscriptions')
@ApiBearerAuth()
@Controller('companies/:companyId/subscriptions')
export class CompanySubscriptionsController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Assign a subscription plan to a company' })
  @ApiResponse({
    status: 201,
    description: 'Subscription assigned successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Company, subscription, or status not found',
  })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateCompanySubscriptionDto,
  ) {
    return this.companySubscriptionsService.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List subscription history for a company' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of company subscriptions',
  })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterCompanySubscriptionDto,
  ) {
    return this.companySubscriptionsService.findAll(companyId, filters);
  }

  @Post('subscribe-free')
  @ApiOperation({ summary: 'Subscribe a company to a free plan (no payment required)' })
  @ApiResponse({ status: 201, description: 'Free subscription created successfully' })
  @ApiResponse({ status: 400, description: 'Plan is not free' })
  @ApiResponse({ status: 409, description: 'Company already has an active subscription' })
  subscribeFree(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SubscribeFreeDto,
  ) {
    return this.companySubscriptionsService.subscribeFree(companyId, dto);
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Subscribe a company to a plan via ePayco recurring billing' })
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

  @Get('current')
  @ApiOperation({ summary: 'Get current active subscription for a company' })
  @ApiResponse({ status: 200, description: 'Current subscription found' })
  @ApiResponse({ status: 404, description: 'No active subscription found' })
  findCurrent(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companySubscriptionsService.findCurrent(companyId);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'List payment history for a company subscription' })
  @ApiResponse({ status: 200, description: 'Paginated payment history' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  findPaymentHistory(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: FilterCompanySubscriptionDto,
  ) {
    return this.companySubscriptionsService.findPaymentHistory(
      companyId,
      id,
      filters.page,
      filters.limit,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific subscription assignment by ID' })
  @ApiResponse({ status: 200, description: 'Subscription assignment found' })
  @ApiResponse({
    status: 404,
    description: 'Subscription assignment not found',
  })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companySubscriptionsService.findById(id, companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a subscription assignment' })
  @ApiResponse({ status: 200, description: 'Subscription assignment updated' })
  @ApiResponse({
    status: 404,
    description: 'Subscription assignment not found',
  })
  update(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanySubscriptionDto,
  ) {
    return this.companySubscriptionsService.update(id, companyId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a subscription assignment' })
  @ApiResponse({ status: 204, description: 'Subscription assignment removed' })
  @ApiResponse({
    status: 404,
    description: 'Subscription assignment not found',
  })
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companySubscriptionsService.remove(id, companyId);
  }
}
