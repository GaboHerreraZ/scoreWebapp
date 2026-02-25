import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
import { SubscriptionsService } from './subscriptions.service.js';
import { CompanySubscriptionsService } from '../company-subscriptions/company-subscriptions.service.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a subscription' })
  @ApiResponse({ status: 201, description: 'Subscription created successfully' })
  create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List all active subscriptions' })
  @ApiResponse({ status: 200, description: 'List of all active subscriptions' })
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @ApiBearerAuth()
  @Get('check-transaction/:paymentId')
  @ApiOperation({ summary: 'Check transaction status by paymentId' })
  @ApiResponse({ status: 200, description: 'Company subscription found' })
  @ApiResponse({ status: 404, description: 'Company subscription not found for the given paymentId' })
  checkTransaction(@Param('paymentId') paymentId: string) {
    return this.companySubscriptionsService.checkTransaction(paymentId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a subscription by ID' })
  @ApiResponse({ status: 200, description: 'Subscription found' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.findById(id);
  }

  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a subscription' })
  @ApiResponse({ status: 200, description: 'Subscription updated successfully' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptionsService.update(id, dto);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a subscription' })
  @ApiResponse({ status: 204, description: 'Subscription deleted successfully' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete: has associated companies' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.remove(id);
  }
}
