import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { ScoringService } from './scoring.service.js';

// Catálogo de dimensiones para CUALQUIER usuario autenticado (admin o no): el
// front de configuración lo consume para pintar qué dimensiones puede habilitar
// la empresa. Solo lectura y solo activas; la administración del catálogo
// (crear/editar/desactivar) vive en el portal admin (/admin/scoring-dimensions).
@ApiTags('Scoring Configuration')
@ApiBearerAuth()
@Controller('scoring-dimensions')
export class ScoringDimensionsController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get()
  @ApiOperation({
    summary: 'Catálogo de dimensiones de scoring disponibles (solo activas)',
    description:
      'Cada dimensión incluye las reglas del motor: required (no se puede deshabilitar), appliesTo (a qué tipo de persona aplica) y supported (si el motor ya la evalúa).',
  })
  @ApiQuery({
    name: 'studyType',
    enum: ['financialStatements', 'paymentCapacity'],
    required: false,
    description:
      'Tipo de estudio: las reglas (required/appliesTo/supported) dependen del motor de ese estudio',
  })
  @ApiResponse({ status: 200, description: 'Dimensiones activas del catálogo' })
  list(@Query('studyType') studyType?: string) {
    return this.scoringService.listDimensions(false, studyType);
  }
}
