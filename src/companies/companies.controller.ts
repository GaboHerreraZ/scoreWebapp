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
import { CompaniesService } from './companies.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { FilterCompanyDto } from './dto/filter-company.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';

@ApiTags('Companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a company' })
  @ApiResponse({ status: 201, description: 'Company created successfully' })
  @ApiResponse({ status: 409, description: 'Company with that NIT already exists' })
  create(@Body() dto: CreateCompanyDto, @Req() req: Request) {
    const userId = (req as any).user.id as string;
    return this.companiesService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List companies with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of companies' })
  findAll(@Query() filters: FilterCompanyDto) {
    return this.companiesService.findAll(filters);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get companies by user ID' })
  @ApiResponse({ status: 200, description: 'List of companies for this user' })
  findByUserId(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.companiesService.findByUserId(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a company by ID' })
  @ApiResponse({ status: 200, description: 'Company found' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.findById(id);
  }

  @Get(':id/available-plans')
  @ApiOperation({ summary: 'Get all available subscription plans with current plan indicated' })
  @ApiResponse({ status: 200, description: 'List of active plans with current plan marked' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  getAvailablePlans(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.getAvailablePlans(id);
  }

  @Get(':id/subscription-usage')
  @ApiOperation({ summary: 'Get subscription details and remaining usage for a company' })
  @ApiResponse({ status: 200, description: 'Subscription data with usage and remaining limits' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  getSubscriptionUsage(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.getSubscriptionUsage(id);
  }

  @Get(':id/customers')
  @ApiOperation({ summary: 'List customers of a company' })
  @ApiResponse({ status: 200, description: 'Paginated list of company customers' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  findCustomers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: PaginationDto,
  ) {
    return this.companiesService.findCustomers(id, filters);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a company' })
  @ApiResponse({ status: 200, description: 'Company updated successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({ status: 409, description: 'NIT uniqueness conflict' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a company' })
  @ApiResponse({ status: 204, description: 'Company deleted successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete: has dependencies' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.remove(id);
  }
}
