import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { PackOfferingsService } from './pack-offerings.service.js';
import { CreatePackOfferingDto } from './dto/create-pack-offering.dto.js';
import { UpdatePackOfferingDto } from './dto/update-pack-offering.dto.js';
import { FilterPackOfferingDto } from './dto/filter-pack-offering.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

@ApiTags('Pack Offerings')
@ApiBearerAuth()
@Controller('pack-offerings')
export class PackOfferingsController {
  constructor(private readonly service: PackOfferingsService) {}

  // ─── Catálogo (cualquier usuario autenticado: lo muestra el front) ──

  @Get('catalog')
  @ApiOperation({
    summary: 'Catálogo de bolsas ofrecibles con precio derivado resuelto',
  })
  @ApiResponse({
    status: 200,
    description: 'Ofertas vigentes con precio calculado (subtotal/desc/total)',
  })
  getCatalog() {
    return this.service.getCatalog();
  }

  // ─── Gestión del catálogo (solo admin del portal) ──────────────────

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Crear una oferta de bolsa' })
  @ApiResponse({ status: 201, description: 'Oferta creada' })
  create(@Body() dto: CreatePackOfferingDto, @Req() req: Request) {
    const userId = (req as any).user.id as string;
    return this.service.create(dto, userId);
  }

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: 'Listar ofertas de bolsas (paginado)' })
  @ApiResponse({ status: 200, description: 'Lista de ofertas' })
  findAll(@Query() filters: FilterPackOfferingDto) {
    return this.service.findAll(filters);
  }

  @Get(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Obtener una oferta de bolsa por ID' })
  @ApiResponse({ status: 200, description: 'Oferta encontrada' })
  @ApiResponse({ status: 404, description: 'Oferta no encontrada' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Actualizar parcialmente una oferta de bolsa' })
  @ApiResponse({ status: 200, description: 'Oferta actualizada' })
  @ApiResponse({ status: 404, description: 'Oferta no encontrada' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackOfferingDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.update(id, dto, userId);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una oferta de bolsa' })
  @ApiResponse({ status: 204, description: 'Oferta eliminada' })
  @ApiResponse({ status: 404, description: 'Oferta no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'No se puede eliminar: hay bolsas compradas con esta oferta',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
