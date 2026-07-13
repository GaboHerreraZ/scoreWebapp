import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
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
import { FinancialStatementsService } from './financial-statements.service.js';
import { ExtractPdfDto } from './dto/extract-pdf.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('Financial Statements')
@ApiBearerAuth()
@CompanyScoped()
@Controller(
  'companies/:companyId/credit-studies/:creditStudyId/financial-statements',
)
export class FinancialStatementsController {
  constructor(
    private readonly financialStatementsService: FinancialStatementsService,
  ) {}

  @Post('extract-pdf')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Extraer los estados financieros de un PDF y adjuntarlos al estudio (períodos + análisis con indicadores)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF con los estados financieros',
        },
        incomeStatementId: { type: 'number', example: 1 },
        fiscalYear: { type: 'number', example: 2024 },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'PDF leído: períodos financieros y análisis con indicadores creados y congelados en el estudio',
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo inválido o extracción fallida',
  })
  @ApiResponse({
    status: 404,
    description: 'Estudio de crédito no encontrado en esta empresa',
  })
  async extractPdf(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ExtractPdfDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo PDF es requerido');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se aceptan archivos en formato PDF');
    }
    // El mimetype lo declara el cliente según la extensión (un .jpg renombrado
    // a .pdf lo pasa); los bytes mágicos del contenido no se pueden falsear así.
    if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new BadRequestException(
        'El archivo no es un PDF válido. Verifica que no sea una imagen u otro documento renombrado a .pdf',
      );
    }
    const userId = (req as any).user.id as string;

    return this.financialStatementsService.extractPdfForStudy(
      file.buffer,
      creditStudyId,
      companyId,
      userId,
      dto,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Listar los análisis financieros congelados por un estudio',
  })
  @ApiResponse({ status: 200, description: 'Análisis financieros del estudio' })
  @ApiResponse({
    status: 404,
    description: 'Estudio de crédito no encontrado en esta empresa',
  })
  findByCreditStudy(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
  ) {
    return this.financialStatementsService.findByCreditStudy(
      creditStudyId,
      companyId,
    );
  }
}
