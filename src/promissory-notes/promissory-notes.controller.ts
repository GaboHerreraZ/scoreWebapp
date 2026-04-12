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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PromissoryNotesService } from './promissory-notes.service.js';
import { CreatePromissoryNoteDto } from './dto/create-promissory-note.dto.js';
import type { DocuSealWebhookPayload } from './dto/docuseal-webhook.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { DocuSealWebhookGuard } from './guards/docuseal-webhook.guard.js';

// ── Spanish-message pipes reused across this controller ──
const companyIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException(
      'El parámetro companyId debe ser un UUID válido.',
    ),
});

const promissoryIdPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException('El parámetro id debe ser un número entero.'),
});

@ApiTags('Promissory Notes')
@ApiBearerAuth()
@Controller()
export class PromissoryNotesController {
  constructor(
    private readonly promissoryNotesService: PromissoryNotesService,
  ) {}

  @Post('companies/:companyId/promissory-notes')
  @ApiOperation({
    summary:
      'Crea un pagaré y lo envía al cliente vía DocuSeal para su firma',
  })
  @ApiResponse({ status: 201, description: 'Pagaré creado y enviado' })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos, faltan campos obligatorios del cliente/empresa, o error de DocuSeal',
  })
  @ApiResponse({
    status: 404,
    description: 'El estudio de crédito no existe en esta empresa',
  })
  @ApiResponse({
    status: 409,
    description: 'Este estudio de crédito ya tiene un pagaré activo',
  })
  create(
    @Param('companyId', companyIdPipe) companyId: string,
    @Body() dto: CreatePromissoryNoteDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.promissoryNotesService.create(companyId, userId, dto);
  }

  @Post('companies/:companyId/promissory-notes/html')
  @ApiOperation({
    summary:
      'Crea un pagaré desde un template HTML y lo envía al cliente vía DocuSeal para su firma',
  })
  @ApiResponse({ status: 201, description: 'Pagaré creado y enviado (HTML)' })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos, faltan campos obligatorios del cliente/empresa, o error de DocuSeal',
  })
  @ApiResponse({
    status: 404,
    description: 'El estudio de crédito no existe en esta empresa',
  })
  @ApiResponse({
    status: 409,
    description: 'Este estudio de crédito ya tiene un pagaré activo',
  })
  createFromHtml(
    @Param('companyId', companyIdPipe) companyId: string,
    @Body() dto: CreatePromissoryNoteDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.promissoryNotesService.createFromHtml(companyId, userId, dto);
  }

  @Post('companies/:companyId/promissory-notes/preview')
  @ApiOperation({
    summary:
      'Retorna un preview del pagaré como HTML con los valores resaltados en negrita',
  })
  @ApiResponse({ status: 200, description: 'Preview HTML del pagaré' })
  @ApiResponse({
    status: 400,
    description: 'Faltan campos obligatorios del cliente o la empresa',
  })
  @ApiResponse({
    status: 404,
    description: 'El estudio de crédito no existe en esta empresa',
  })
  preview(
    @Param('companyId', companyIdPipe) companyId: string,
    @Body() dto: CreatePromissoryNoteDto,
  ) {
    return this.promissoryNotesService.preview(companyId, dto);
  }

  @Patch('companies/:companyId/promissory-notes/:id/decline')
  @ApiOperation({
    summary: 'Declina un pagaré pendiente de firma y revierte el estudio de crédito a estudio realizado',
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

  @Get('companies/:companyId/promissory-notes')
  @ApiOperation({ summary: 'Lista los pagarés de una empresa' })
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

  @Get('companies/:companyId/promissory-notes/:id')
  @ApiOperation({ summary: 'Obtiene un pagaré por ID' })
  findById(
    @Param('companyId', companyIdPipe) companyId: string,
    @Param('id', promissoryIdPipe) id: number,
  ) {
    return this.promissoryNotesService.findById(id, companyId);
  }

  // ─── DocuSeal webhook (public; verified by X-Webhook-Secret header + DocuSeal API check) ──
  @Public()
  @UseGuards(DocuSealWebhookGuard)
  @Post('promissory-notes/webhooks/docuseal')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async docuSealWebhook(@Body() payload: DocuSealWebhookPayload) {
    await this.promissoryNotesService.handleDocuSealWebhook(payload);
    return { received: true };
  }
}
