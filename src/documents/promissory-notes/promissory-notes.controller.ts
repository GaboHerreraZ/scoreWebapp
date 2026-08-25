import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PromissoryNotesService } from './promissory-notes.service.js';
import { CreatePromissoryNoteDto } from './dto/create-promissory-note.dto.js';
import { CompanyScoped } from '../../common/decorators/company-scoped.decorator.js';

// ── Spanish-message pipes reused across this controller ──
const companyIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El parámetro companyId debe ser un UUID válido.'),
});

const promissoryIdPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException('El parámetro id debe ser un número entero.'),
});

@ApiTags('Promissory Notes')
@ApiBearerAuth()
@CompanyScoped()
@Controller()
export class PromissoryNotesController {
  constructor(
    private readonly promissoryNotesService: PromissoryNotesService,
  ) {}

  @Post('companies/:companyId/documents/promissory-notes/preview')
  @ApiOperation({
    summary:
      'Vista previa del pagaré: valida y resuelve las variables del documento sin emitir nada',
  })
  @ApiResponse({
    status: 201,
    description:
      'HTML del pagaré ya rellenado + consecutivo tentativo (no emite nada)',
  })
  @ApiResponse({
    status: 400,
    description:
      'Estudio no viable o datos faltantes (email del firmante / cuenta bancaria de la empresa)',
  })
  @ApiResponse({
    status: 409,
    description: 'El estudio ya tiene un pagaré pendiente o firmado',
  })
  preview(
    @Param('companyId', companyIdPipe) companyId: string,
    @Body() dto: CreatePromissoryNoteDto,
  ) {
    return this.promissoryNotesService.preview(companyId, dto);
  }

  @Post('companies/:companyId/documents/promissory-notes')
  @ApiOperation({
    summary:
      'Emite el pagaré de un estudio viable y lo envía a firma del consultado',
  })
  @ApiResponse({ status: 201, description: 'Pagaré emitido y enviado a firma' })
  @ApiResponse({
    status: 400,
    description:
      'Estudio no viable o datos faltantes (email del firmante / cuenta bancaria de la empresa)',
  })
  @ApiResponse({
    status: 409,
    description: 'El estudio ya tiene un pagaré pendiente o firmado',
  })
  issue(
    @Param('companyId', companyIdPipe) companyId: string,
    @Body() dto: CreatePromissoryNoteDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.promissoryNotesService.issue(companyId, userId, dto);
  }

  @Get('companies/:companyId/documents/promissory-notes/:id/document')
  @ApiOperation({
    summary: 'URL temporal del PDF firmado del pagaré',
  })
  @ApiResponse({ status: 200, description: 'URL firmada del PDF' })
  @ApiResponse({ status: 400, description: 'El pagaré aún no está firmado' })
  async getSignedDocument(
    @Param('companyId', companyIdPipe) companyId: string,
    @Param('id', promissoryIdPipe) id: number,
  ) {
    const url = await this.promissoryNotesService.getSignedDocumentUrl(
      id,
      companyId,
    );
    return { url };
  }

  @Patch('companies/:companyId/documents/promissory-notes/:id/decline')
  @ApiOperation({
    summary:
      'Declina un pagaré pendiente de firma y revierte el estudio de crédito a estudio realizado',
  })
  @ApiResponse({ status: 200, description: 'Pagaré declinado exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'El pagaré no está pendiente de firma',
  })
  @ApiResponse({
    status: 404,
    description: 'El pagaré no existe en esta empresa',
  })
  decline(
    @Param('companyId', companyIdPipe) companyId: string,
    @Param('id', promissoryIdPipe) id: number,
  ) {
    return this.promissoryNotesService.decline(id, companyId);
  }

  @Post('companies/:companyId/documents/promissory-notes/:id/payment-reminder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Envía el recordatorio de pago del pagaré: correo al deudor con valor, vencimiento y cuenta del acreedor, y confirmación a los admins de la empresa',
  })
  @ApiResponse({ status: 200, description: 'Recordatorio enviado' })
  @ApiResponse({
    status: 400,
    description:
      'El pagaré no está firmado, no tiene vencimiento o el cliente no tiene correo',
  })
  @ApiResponse({
    status: 404,
    description: 'El pagaré no existe en esta empresa',
  })
  sendPaymentReminder(
    @Param('companyId', companyIdPipe) companyId: string,
    @Param('id', promissoryIdPipe) id: number,
  ) {
    return this.promissoryNotesService.sendPaymentReminder(id, companyId);
  }

  @Get('companies/:companyId/documents/promissory-notes')
  @ApiOperation({
    summary:
      'Lista los pagarés de una empresa (datos principales: número, cliente, monto, estado y fechas)',
  })
  findAll(
    @Param('companyId', companyIdPipe) companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.promissoryNotesService.findAll(
      companyId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 10,
    );
  }

  @Get('companies/:companyId/documents/promissory-notes/:id')
  @ApiOperation({
    summary:
      'Obtiene un pagaré por ID con su cliente, empresa y el estudio de crédito (score y viabilidad)',
  })
  findById(
    @Param('companyId', companyIdPipe) companyId: string,
    @Param('id', promissoryIdPipe) id: number,
  ) {
    return this.promissoryNotesService.findById(id, companyId);
  }
}
