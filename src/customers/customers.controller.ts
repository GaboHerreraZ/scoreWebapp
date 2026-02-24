import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
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
import type { Request } from 'express';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { FilterCustomerDto } from './dto/filter-customer.dto.js';
import { AutocompleteCustomerDto } from './dto/autocomplete-customer.dto.js';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('companies/:companyId/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a customer in a company' })
  @ApiResponse({ status: 201, description: 'Customer created successfully' })
  @ApiResponse({ status: 409, description: 'Customer with that identification already exists in this company' })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateCustomerDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.customersService.create(companyId, userId, dto);
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Autocomplete customers by business name' })
  @ApiResponse({ status: 200, description: 'List of customers with id and businessName only' })
  autocomplete(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: AutocompleteCustomerDto,
  ) {
    return this.customersService.autocomplete(companyId, filters);
  }

  @Get()
  @ApiOperation({ summary: 'List customers of a company with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of customers' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterCustomerDto,
  ) {
    return this.customersService.findAll(companyId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer by ID within a company' })
  @ApiResponse({ status: 200, description: 'Customer found' })
  @ApiResponse({ status: 404, description: 'Customer not found in this company' })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.findById(id, companyId);
  }

  @Get(':id/credit-studies')
  @ApiOperation({ summary: 'List credit studies of a customer' })
  @ApiResponse({ status: 200, description: 'Paginated list of credit studies' })
  @ApiResponse({ status: 404, description: 'Customer not found in this company' })
  findCreditStudies(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.findCreditStudies(id, companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a customer' })
  @ApiResponse({ status: 200, description: 'Customer updated successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found in this company' })
  @ApiResponse({ status: 409, description: 'Identification uniqueness conflict' })
  update(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.customersService.update(id, companyId, userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a customer' })
  @ApiResponse({ status: 204, description: 'Customer deleted successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found in this company' })
  @ApiResponse({ status: 409, description: 'Cannot delete: has credit studies' })
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.remove(id, companyId);
  }
}
