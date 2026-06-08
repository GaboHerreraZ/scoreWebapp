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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AiAnalysesService } from './ai-analyses.service.js';
import { FilterAiAnalysisDto } from './dto/filter-ai-analysis.dto.js';
import { ExtractPdfCreateStudyDto } from './dto/extract-pdf-create-study.dto.js';
import { CreditStudiesService } from '../credit-studies/credit-studies.service.js';
import type { CreateCreditStudyDto } from '../credit-studies/dto/create-credit-study.dto.js';

@ApiTags('AI Analyses')
@ApiBearerAuth()
@Controller('companies/:companyId/ai-analyses')
export class AiAnalysesController {
  constructor(
    private readonly aiAnalysesService: AiAnalysesService,
    private readonly creditStudiesService: CreditStudiesService,
  ) {}

  @Post('extract-pdf')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Extract financial data + reliability flags from a PDF and create the credit study',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF file with financial statements',
        },
        customerId: { type: 'string', format: 'uuid' },
        studyDate: { type: 'string', example: '2026-06-08' },
        notes: { type: 'string' },
        requestedTerm: { type: 'number', example: 60 },
        requestedCreditLine: { type: 'number', example: 50000000 },
        incomeStatementId: { type: 'number', example: 1 },
      },
      required: ['file', 'customerId', 'studyDate'],
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'PDF read once: financial data + reliability flags extracted and credit study created',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid file, subscription limit reached, or extraction failed',
  })
  async extractPdf(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ExtractPdfCreateStudyDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo PDF es requerido');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se aceptan archivos en formato PDF');
    }
    const userId = (req as any).user.id as string;

    // 1. La IA lee el PDF UNA sola vez: extrae datos financieros + red flags.
    const { financialData, reliabilityFlags } =
      await this.aiAnalysesService.extractPdf(file.buffer, companyId, userId);

    // 2. Se crea el estudio de inmediato con los datos del usuario + los
    //    extraidos, persistiendo las red flags de fiabilidad. Asi no se pierde
    //    la lectura del PDF si el usuario refresca la pantalla.
    const { balanceSheetDate, ...financialFields } = financialData as Record<
      string,
      unknown
    >;
    const createDto = {
      customerId: dto.customerId,
      studyDate: dto.studyDate,
      notes: dto.notes,
      requestedTerm: dto.requestedTerm,
      requestedCreditLine: dto.requestedCreditLine,
      incomeStatementId: dto.incomeStatementId,
      ...financialFields,
      balanceSheetDate:
        typeof balanceSheetDate === 'string' && balanceSheetDate
          ? new Date(balanceSheetDate)
          : undefined,
    } as CreateCreditStudyDto;

    return this.creditStudiesService.createFromExtraction(
      companyId,
      userId,
      createDto,
      reliabilityFlags,
    );
  }

  @Post('credit-studies/:creditStudyId')
  @ApiOperation({ summary: 'Run AI analysis on a credit study' })
  @ApiResponse({
    status: 201,
    description: 'AI analysis completed and saved successfully',
  })
  @ApiResponse({
    status: 400,
    description:
      'Study not performed, subscription limit reached, or AI call failed',
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

  @Get('usage')
  @ApiOperation({ summary: 'Get AI analysis usage for the current month' })
  @ApiResponse({ status: 200, description: 'Current month AI usage stats' })
  getUsage(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.aiAnalysesService.getUsage(companyId);
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
