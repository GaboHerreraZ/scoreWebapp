import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PromoCodesService } from './promo-codes.service.js';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto.js';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto.js';
import { FilterPromoCodeDto } from './dto/filter-promo-code.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

@ApiTags('Promo Codes (Admin)')
@AdminOnly()
@Controller('promo-codes')
export class PromoCodesController {
  constructor(private readonly service: PromoCodesService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un código promocional (empresa o global)' })
  @ApiResponse({ status: 201, description: 'Código creado' })
  @ApiResponse({ status: 409, description: 'El code ya existe' })
  create(@Body() dto: CreatePromoCodeDto, @Req() req: Request) {
    const userId = (req as any).user.id as string;
    return this.service.create(dto, userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar códigos promocionales (paginado, filtrable)',
  })
  @ApiResponse({ status: 200, description: 'data + meta de paginación' })
  findAll(@Query() filters: FilterPromoCodeDto) {
    return this.service.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un código' })
  @ApiResponse({ status: 200, description: 'Código' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Editar código (solo isActive, vigencia y nota; el resto es inmutable)',
  })
  @ApiResponse({ status: 200, description: 'Código actualizado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromoCodeDto,
  ) {
    return this.service.update(id, dto);
  }
}
