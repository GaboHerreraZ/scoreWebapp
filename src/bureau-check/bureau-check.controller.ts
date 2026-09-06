import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
import { BureauCheckService } from './bureau-check.service.js';
import { CreateBureauCheckDto } from './dto/create-bureau-check.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

// Flujo PROPIO de la consulta de riesgo crediticio (bureauCheck): creación,
// análisis y detalle viven aquí — los endpoints de credit-studies rechazan este
// tipo. La fila sigue siendo un CreditStudy (bolsa 1:1, listados).
@ApiTags('Bureau Checks')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/bureau-checks')
export class BureauCheckController {
  constructor(private readonly service: BureauCheckService) {}

  @Post()
  @ApiOperation({
    summary:
      'Consultar al titular en la central y crear la consulta de riesgo (consume bolsa bureauCheck)',
  })
  @ApiResponse({
    status: 201,
    description:
      "creada ('created') o firma pendiente ('authorization_pending')",
  })
  @ApiResponse({ status: 409, description: 'Sin saldo de consultas de riesgo' })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateBureauCheckDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.create(companyId, userId, dto);
  }

  @Post(':id/perform')
  @ApiOperation({
    summary:
      'Generar el análisis IA de la consulta (gratis; reintenta si falló)',
  })
  @ApiResponse({ status: 201, description: 'Detalle con el análisis generado' })
  perform(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.perform(id, companyId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de la consulta (identidad + análisis)' })
  @ApiResponse({ status: 200, description: 'Detalle' })
  @ApiResponse({ status: 404, description: 'No encontrada en esta empresa' })
  getDetail(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getDetail(id, companyId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Informe PDF de la consulta (plantilla propia)' })
  @ApiResponse({ status: 200, description: 'PDF inline' })
  async getPdf(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.service.generateReportPdf(
      id,
      companyId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }
}
