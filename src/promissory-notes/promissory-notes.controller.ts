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
