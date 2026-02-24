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
import { UserCompaniesService } from './user-companies.service.js';
import { CreateUserCompanyDto } from './dto/create-user-company.dto.js';
import { UpdateUserCompanyDto } from './dto/update-user-company.dto.js';
import { FilterUserCompanyDto } from './dto/filter-user-company.dto.js';

@ApiTags('User Companies')
@ApiBearerAuth()
@Controller('companies/:companyId/users')
export class UserCompaniesController {
  constructor(private readonly userCompaniesService: UserCompaniesService) {}

  @Post()
  @ApiOperation({ summary: 'Invite a user to a company' })
  @ApiResponse({ status: 201, description: 'User invited successfully' })
  @ApiResponse({ status: 404, description: 'Profile or company not found' })
  @ApiResponse({ status: 409, description: 'User is already associated with this company' })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateUserCompanyDto,
    @Req() req: Request,
  ) {
    const invitedBy = (req as any).user.id as string;
    return this.userCompaniesService.create(companyId, invitedBy, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List users of a company' })
  @ApiResponse({ status: 200, description: 'Paginated list of company users' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterUserCompanyDto,
  ) {
    return this.userCompaniesService.findAll(companyId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user-company relation by ID' })
  @ApiResponse({ status: 200, description: 'Relation found' })
  @ApiResponse({ status: 404, description: 'Relation not found in this company' })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.userCompaniesService.findById(id, companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update role or status of a user in a company' })
  @ApiResponse({ status: 200, description: 'Relation updated successfully' })
  @ApiResponse({ status: 404, description: 'Relation not found in this company' })
  @ApiResponse({ status: 400, description: 'Invalid role' })
  update(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserCompanyDto,
  ) {
    return this.userCompaniesService.update(id, companyId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a user from a company' })
  @ApiResponse({ status: 204, description: 'Relation deleted successfully' })
  @ApiResponse({ status: 404, description: 'Relation not found in this company' })
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.userCompaniesService.remove(id, companyId);
  }
}
