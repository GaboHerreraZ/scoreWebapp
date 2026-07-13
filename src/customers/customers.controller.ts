import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CustomersService } from './customers.service.js';
import { FilterCustomerDto } from './dto/filter-customer.dto.js';
import { AutocompleteCustomerDto } from './dto/autocomplete-customer.dto.js';
import { CustomerDetailResponseDto } from './dto/customer-detail-response.dto.js';
import { CustomerStatsResponseDto } from './dto/customer-stats-response.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('Customers')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // El alta manual de clientes (POST) se retiró: el Customer nace de una consulta
  // a DataCrédito (módulo credit-bureau). Igual el PATCH de edición manual.

  @Get('export')
  @ApiOperation({ summary: 'Export customers of a company to Excel' })
  @ApiResponse({ status: 200, description: 'Excel file (.xlsx)' })
  async export(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName } =
      await this.customersService.exportToExcel(companyId);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    return new StreamableFile(buffer);
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Autocomplete customers by business name' })
  @ApiResponse({
    status: 200,
    description: 'List of customers with id and businessName only',
  })
  autocomplete(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: AutocompleteCustomerDto,
  ) {
    return this.customersService.autocomplete(companyId, filters);
  }

  @Get()
  @ApiOperation({
    summary: 'List customers of a company with pagination and filters',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of customers' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterCustomerDto,
  ) {
    return this.customersService.findAll(companyId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer by ID within a company' })
  @ApiResponse({
    status: 200,
    description: 'Customer found (PN or PJ)',
    type: CustomerDetailResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Customer not found in this company',
  })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.findById(id, companyId);
  }

  @Get(':id/stats')
  @ApiOperation({
    summary:
      'Quick-glance credit behavior stats of a customer within the company',
  })
  @ApiResponse({
    status: 200,
    description: 'Aggregated stats over the customer credit studies',
    type: CustomerStatsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Customer not found in this company',
  })
  getStats(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.getStats(id, companyId);
  }

  @Get(':id/credit-studies')
  @ApiOperation({ summary: 'List credit studies of a customer' })
  @ApiResponse({ status: 200, description: 'Paginated list of credit studies' })
  @ApiResponse({
    status: 404,
    description: 'Customer not found in this company',
  })
  findCreditStudies(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.findCreditStudies(id, companyId);
  }
}
