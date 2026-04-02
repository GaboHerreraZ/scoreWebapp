import {
  Controller,
  Get,
  Post,
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

@ApiTags('AI Analyses')
@ApiBearerAuth()
@Controller('companies/:companyId/ai-analyses')
export class AiAnalysesController {
  constructor(private readonly aiAnalysesService: AiAnalysesService) {}

  @Post('extract-pdf')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Extract financial data from a PDF using AI' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF file with financial statements' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Financial data extracted successfully from PDF',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file, subscription limit reached, or extraction failed',
  })
  extractPdf(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo PDF es requerido');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se aceptan archivos en formato PDF');
    }
    const userId = (req as any).user.id as string;
    return this.aiAnalysesService.extractPdf(file.buffer, companyId, userId);
  }

  @Post('credit-studies/:creditStudyId')
  @ApiOperation({ summary: 'Run AI analysis on a credit study' })
  @ApiResponse({
    status: 201,
    description: 'AI analysis completed and saved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Study not performed, subscription limit reached, or AI call failed',
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
