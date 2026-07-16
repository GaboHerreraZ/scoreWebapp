import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
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
  @ApiResponse({ status: 200, description: 'Dimensiones activas del catálogo' })
  list() {
    return this.scoringService.listDimensions(false);
  }
}
