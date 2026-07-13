import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AiAnalysesService } from './ai-analyses.service.js';
import { FilterAiAnalysisDto } from './dto/filter-ai-analysis.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('AI Analyses')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/ai-analyses')
export class AiAnalysesController {
  constructor(private readonly aiAnalysesService: AiAnalysesService) {}

  // NOTA: la extracción de PDF de estados financieros se movió a
  // FinancialStatementsController (POST .../credit-studies/:id/financial-statements/
  // extract-pdf). Este módulo conserva AiAnalysesService.extractPdf como la
  // corrida IA + log en la tabla AiAnalysis, que financial-statements consume.

  @Post('credit-studies/:creditStudyId')
  @ApiOperation({
    summary: 'Generar el informe ejecutivo IA de un estudio ya realizado',
    description:
      'Requiere que el estudio ya tenga el análisis de viabilidad (POST .../perform). Arma un prompt v2 con las 7 dimensiones ponderadas, el monto aprobado (techo de la central), ambas fuentes de EEFF, el score de la central y las dos capas de red flags; genera un informe narrativo consciente del tipo de persona (PN/PJ).',
  })
  @ApiResponse({
    status: 201,
    description: 'Informe IA generado y guardado',
  })
  @ApiResponse({
    status: 400,
    description: 'El estudio no ha sido realizado, o la llamada a la IA falló',
  })
  @ApiResponse({
    status: 404,
    description: 'Credit study not found in this company',
  })
  analyze(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.aiAnalysesService.analyze(creditStudyId, companyId, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List AI analyses for a company' })
  @ApiResponse({ status: 200, description: 'Paginated list of AI analyses' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterAiAnalysisDto,
  ) {
    return this.aiAnalysesService.findAll(companyId, filters);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download the PDF file stored for an AI analysis' })
  @ApiResponse({ status: 200, description: 'PDF file returned' })
  @ApiResponse({ status: 404, description: 'Analysis or PDF not found' })
  async getPdf(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.aiAnalysesService.getPdf(id, companyId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="analysis-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an AI analysis by ID' })
  @ApiResponse({ status: 200, description: 'AI analysis found' })
  @ApiResponse({
    status: 404,
    description: 'AI analysis not found in this company',
  })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aiAnalysesService.findById(id, companyId);
  }
}
