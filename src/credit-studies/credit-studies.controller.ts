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
import { CreditStudiesService } from './credit-studies.service.js';
import { CreateCreditStudyDto } from './dto/create-credit-study.dto.js';
import { UpdateCreditStudyDto } from './dto/update-credit-study.dto.js';
import { FilterCreditStudyDto } from './dto/filter-credit-study.dto.js';

@ApiTags('Credit Studies')
@ApiBearerAuth()
@Controller('companies/:companyId/credit-studies')
export class CreditStudiesController {
  constructor(private readonly creditStudiesService: CreditStudiesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a credit study' })
  @ApiResponse({
    status: 201,
    description: 'Credit study created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Customer does not belong to this company',
  })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateCreditStudyDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.creditStudiesService.create(companyId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List credit studies of a company' })
  @ApiResponse({ status: 200, description: 'Paginated list of credit studies' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterCreditStudyDto,
  ) {
    return this.creditStudiesService.findAll(companyId, filters);
  }

  @Get(':id/perform')
  @ApiOperation({ summary: 'Get credit study for calculations' })
  @ApiResponse({
    status: 200,
    description: 'Credit study data for calculations',
  })
  @ApiResponse({
    status: 404,
    description: 'Credit study not found in this company',
  })
  perform(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;

    return this.creditStudiesService.getCreditStudyPerform(
      id,
      companyId,
      userId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a credit study by ID' })
  @ApiResponse({ status: 200, description: 'Credit study found' })
  @ApiResponse({
    status: 404,
    description: 'Credit study not found in this company',
  })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.creditStudiesService.findById(id, companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a credit study' })
  @ApiResponse({
    status: 200,
    description: 'Credit study updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Credit study not found in this company',
  })
  @ApiResponse({
    status: 400,
    description: 'Customer does not belong to this company',
  })
  update(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreditStudyDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.creditStudiesService.update(id, companyId, userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a credit study' })
  @ApiResponse({
    status: 204,
    description: 'Credit study deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Credit study not found in this company',
  })
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.creditStudiesService.remove(id, companyId);
  }
}
