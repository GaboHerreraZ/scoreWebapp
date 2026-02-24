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
import { CreateTransactionDto } from './dto/create-transaction.dto.js';

@ApiTags('Company Subscriptions')
@ApiBearerAuth()
@Controller('companies/:companyId/subscriptions')
export class CompanySubscriptionsController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Assign a subscription plan to a company' })
  @ApiResponse({ status: 201, description: 'Subscription assigned successfully' })
  @ApiResponse({ status: 404, description: 'Company, subscription, or status not found' })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateCompanySubscriptionDto,
  ) {
    return this.companySubscriptionsService.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List subscription history for a company' })
  @ApiResponse({ status: 200, description: 'Paginated list of company subscriptions' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterCompanySubscriptionDto,
  ) {
    return this.companySubscriptionsService.findAll(companyId, filters);
  }

  @Post('create-transaction')
  @ApiOperation({ summary: 'Create a subscription transaction for a company' })
  @ApiResponse({ status: 201, description: 'Transaction created successfully' })
  @ApiResponse({ status: 404, description: 'Company, subscription, or status parameter not found' })
  @ApiResponse({ status: 409, description: 'Company already has an active subscription' })
  createTransaction(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.companySubscriptionsService.createTransaction(companyId, dto);
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current active subscription for a company' })
  @ApiResponse({ status: 200, description: 'Current subscription found' })
  @ApiResponse({ status: 404, description: 'No active subscription found' })
  findCurrent(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companySubscriptionsService.findCurrent(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific subscription assignment by ID' })
  @ApiResponse({ status: 200, description: 'Subscription assignment found' })
  @ApiResponse({ status: 404, description: 'Subscription assignment not found' })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companySubscriptionsService.findById(id, companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a subscription assignment' })
  @ApiResponse({ status: 200, description: 'Subscription assignment updated' })
  @ApiResponse({ status: 404, description: 'Subscription assignment not found' })
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
  @ApiResponse({ status: 404, description: 'Subscription assignment not found' })
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companySubscriptionsService.remove(id, companyId);
  }
}
