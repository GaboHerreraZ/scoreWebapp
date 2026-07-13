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

  @Post()
  @ApiOperation({
    summary:
      'Crear una nueva versión de configuración para un tipo de persona (la vigente de ese tipo pasa a histórica)',
    description:
      'Los pesos deben sumar 100. En PJ las 7 dimensiones aplican (cada peso >= 5). En PN la veracidad debe ser 0 (no hay contraste) y las otras 6 suman 100.',
  })
  @ApiQuery({ name: 'personType', enum: ['naturalPerson', 'legalEntity'] })
  @ApiResponse({ status: 201, description: 'Nueva config creada y vigente' })
  @ApiResponse({
    status: 400,
    description: 'Pesos inválidos (no suman 100, < mínimo, o veracity≠0 en PN)',
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
