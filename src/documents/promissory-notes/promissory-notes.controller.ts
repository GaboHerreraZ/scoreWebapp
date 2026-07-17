import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PromissoryNotesService } from './promissory-notes.service.js';
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

// La creación/envío a firma del pagaré fue retirada junto con DocuSeal; se
// reconectará con el proveedor de firma vigente cuando se retome el flujo.
@ApiTags('Promissory Notes')
@ApiBearerAuth()
@CompanyScoped()
@Controller()
export class PromissoryNotesController {
  constructor(
    private readonly promissoryNotesService: PromissoryNotesService,
  ) {}

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

  @Get('companies/:companyId/documents/promissory-notes')
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

  @Get('companies/:companyId/documents/promissory-notes/:id')
  @ApiOperation({ summary: 'Obtiene un pagaré por ID' })
  findById(
    @Param('companyId', companyIdPipe) companyId: string,
    @Param('id', promissoryIdPipe) id: number,
  ) {
    return this.promissoryNotesService.findById(id, companyId);
  }
}
