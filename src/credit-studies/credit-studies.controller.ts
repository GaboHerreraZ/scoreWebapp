import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
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
import type { Request, Response } from 'express';
import { CreditStudiesService } from './credit-studies.service.js';
import { FilterCreditStudyDto } from './dto/filter-credit-study.dto.js';
import { CreateStudyFromBureauDto } from './dto/create-study-from-bureau.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('Credit Studies')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/credit-studies')
export class CreditStudiesController {
  constructor(private readonly creditStudiesService: CreditStudiesService) {}

  @Post('from-bureau')
  @ApiOperation({
    summary:
      'Consultar el cliente en la central y crear el estudio (única entrada)',
  })
  @ApiResponse({
    status: 201,
    description: 'Cliente consultado/actualizado y estudio creado',
  })
  @ApiResponse({
    status: 404,
    description: 'La central no tiene información para la identificación',
  })
  @ApiResponse({
    status: 409,
    description: 'Sin saldo de consultas disponible',
  })
  createFromBureau(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateStudyFromBureauDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.creditStudiesService.createFromBureau(companyId, userId, dto);
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

  @Get('export')
  @ApiOperation({ summary: 'Export credit studies of a company to Excel' })
  @ApiResponse({ status: 200, description: 'Excel file (.xlsx)' })
  async export(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName } =
      await this.creditStudiesService.exportToExcel(companyId);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    return new StreamableFile(buffer);
  }

  @Post(':id/perform')
  @ApiOperation({
    summary: 'Realizar el análisis de viabilidad del estudio (step3)',
    description:
      'Corre el motor de scoring de 7 dimensiones sobre DataCrédito (fallback PDF), contrasta veracidad, pondera con la config vigente de la empresa, congela esa config en el estudio y persiste el resultado.',
  })
  @ApiResponse({
    status: 201,
    description: 'Análisis realizado (score + viabilidad)',
  })
  @ApiResponse({
    status: 400,
    description: 'Sin estados financieros para analizar, o estudio bloqueado',
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
    return this.creditStudiesService.performStudy(id, companyId, userId);
  }

  @Get(':id/steps')
  @ApiOperation({
    summary: 'Get the stepper data of a credit study (step1: customer)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Stepper: status + step1 (customer), step2/step3 null hasta completarse',
  })
  @ApiResponse({
    status: 404,
    description: 'Credit study not found in this company',
  })
  getSteps(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.creditStudiesService.getSteps(id, companyId);
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
}
