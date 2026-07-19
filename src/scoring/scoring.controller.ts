import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ScoringService } from './scoring.service.js';
import { CreateScoringConfigurationDto } from './dto/create-scoring-configuration.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('Scoring Configuration')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/scoring-configurations')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get('active')
  @ApiOperation({
    summary:
      'Configuración de scoring vigente de la empresa por tipo de persona',
    description:
      'Devuelve la config activa del tipo (naturalPerson | legalEntity). Si la empresa no tiene ninguna, devuelve los pesos default del sistema con isDefault=true (aún no persistidos).',
  })
  @ApiQuery({ name: 'personType', enum: ['naturalPerson', 'legalEntity'] })
  @ApiResponse({ status: 200, description: 'Config vigente (o defaults)' })
  getActive(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('personType') personType: string,
  ) {
    return this.scoringService.getActive(companyId, personType);
  }

  @Get()
  @ApiOperation({ summary: 'Historial de configuraciones de la empresa' })
  @ApiQuery({
    name: 'personType',
    enum: ['naturalPerson', 'legalEntity'],
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de configs (reciente primero)',
  })
  getHistory(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('personType') personType?: string,
  ) {
    return this.scoringService.getHistory(companyId, personType);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Una configuración por id' })
  @ApiResponse({ status: 200, description: 'Config encontrada' })
  @ApiResponse({
    status: 404,
    description: 'Config no encontrada en esta empresa',
  })
  getById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scoringService.getById(companyId, id);
  }

  @Post('reset')
  @ApiOperation({
    summary:
      'Restaurar la configuración de un tipo de persona a los valores por defecto del sistema',
    description:
      'Crea una nueva versión con los pesos default del tipo (naturalPerson | legalEntity) y la marca vigente; la anterior pasa a histórica. No requiere body: los pesos los pone el sistema.',
  })
  @ApiQuery({ name: 'personType', enum: ['naturalPerson', 'legalEntity'] })
  @ApiResponse({
    status: 201,
    description: 'Config restaurada a defaults y vigente',
  })
  @ApiResponse({
    status: 400,
    description:
      'Tipo de persona inválido o una dimensión del default está desactivada en el catálogo',
  })
  resetToDefaults(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('personType') personType: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.scoringService.resetToDefaults(companyId, userId, personType);
  }

  @Post()
  @ApiOperation({
    summary:
      'Crear una nueva versión de configuración para un tipo de persona (la vigente de ese tipo pasa a histórica)',
    description:
      'El body trae SOLO las dimensiones habilitadas con su peso; las ausentes quedan deshabilitadas y no participan del estudio. Los pesos habilitados suman 100 (cada uno >= 5). Las dimensiones obligatorias (paymentCapacity, centralRisk) no pueden faltar y veracity no aplica en PN.',
  })
  @ApiQuery({ name: 'personType', enum: ['naturalPerson', 'legalEntity'] })
  @ApiResponse({ status: 201, description: 'Nueva config creada y vigente' })
  @ApiResponse({
    status: 400,
    description:
      'Pesos inválidos (no suman 100, < mínimo, falta una obligatoria, dimensión que no aplica al tipo o no existe/inactiva en el catálogo)',
  })
  createVersion(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('personType') personType: string,
    @Body() dto: CreateScoringConfigurationDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.scoringService.createVersion(
      companyId,
      userId,
      personType,
      dto,
    );
  }
}
