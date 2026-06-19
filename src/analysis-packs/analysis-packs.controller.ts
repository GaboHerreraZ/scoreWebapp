import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AnalysisPacksService } from './analysis-packs.service.js';
import { PurchasePackDto } from './dto/purchase-pack.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('Analysis Packs')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/analysis-packs')
export class AnalysisPacksController {
  constructor(private readonly service: AnalysisPacksService) {}

  @Post('purchase')
  @ApiOperation({
    summary: 'Iniciar compra de un pack (devuelve datos del checkout ePayco)',
  })
  @ApiResponse({
    status: 201,
    description: 'Bolsa creada en pending_payment + datos del checkout onepage',
  })
  @ApiResponse({ status: 404, description: 'Oferta no disponible' })
  purchase(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PurchasePackDto,
  ) {
    return this.service.purchase(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Historial de bolsas de la empresa' })
  @ApiResponse({ status: 200, description: 'Lista de bolsas' })
  findAll(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.service.findByCompany(companyId);
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Saldo de consultas disponible (bolsas activas y vigentes)',
  })
  @ApiResponse({
    status: 200,
    description: 'availableCredits + detalle de bolsas con saldo',
  })
  getBalance(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.service.getBalance(companyId);
  }

  @Get('with-consumptions')
  @ApiOperation({
    summary: 'Bolsas de la empresa (paginadas) con sus consumos agrupados',
  })
  @ApiResponse({
    status: 200,
    description:
      'data: bolsas + consumptions por bolsa (customer, estado, autor); meta: paginación',
  })
  getWithConsumptions(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: PaginationDto,
  ) {
    return this.service.getPacksWithConsumptions(companyId, filters);
  }
}
