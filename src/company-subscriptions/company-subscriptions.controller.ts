import { Controller, Post, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { ChangePlanDto } from './dto/change-plan.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('Company Subscriptions')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/subscriptions')
export class CompanySubscriptionsController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
  ) {}

  @Post('cancel')
  @ApiOperation({
    summary:
      'Cancel the current subscription. The company is left without an active subscription and loses access.',
  })
  @ApiResponse({
    status: 201,
    description: 'Subscription cancelled',
  })
  @ApiResponse({
    status: 404,
    description: 'Company or active subscription not found',
  })
  cancel(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companySubscriptionsService.cancel(companyId);
  }

  @Post('change-plan')
  @ApiOperation({
    summary:
      'Change the company subscription plan (free or paid). Reuses the existing ePayco customer when available.',
  })
  @ApiResponse({ status: 201, description: 'Plan changed successfully' })
  @ApiResponse({
    status: 400,
    description:
      'Same plan, plan limits exceeded by current resources, or payment data missing/invalid',
  })
  @ApiResponse({
    status: 404,
    description: 'Company, current subscription, or new plan not found',
  })
  changePlan(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.companySubscriptionsService.changePlan(companyId, dto);
  }
}
