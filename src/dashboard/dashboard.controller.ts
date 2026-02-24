import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service.js';
import { FilterDashboardDto } from './dto/filter-dashboard.dto.js';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('companies/:companyId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('basic')
  @ApiOperation({ summary: 'Get basic dashboard KPIs and charts' })
  @ApiResponse({ status: 200, description: 'Basic dashboard data' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  getBasic(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.dashboardService.getBasicDashboard(companyId);
  }

  @Get('advanced')
  @ApiOperation({ summary: 'Get advanced dashboard with financial analytics' })
  @ApiResponse({ status: 200, description: 'Advanced dashboard data' })
  @ApiResponse({
    status: 403,
    description: 'Subscription does not include advanced dashboard',
  })
  @ApiResponse({ status: 404, description: 'Company not found' })
  getAdvanced(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterDashboardDto,
  ) {
    return this.dashboardService.getAdvancedDashboard(companyId, filters);
  }
}
