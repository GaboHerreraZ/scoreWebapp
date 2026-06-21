import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ContactRequestsService } from './contact-requests.service.js';
import { FilterContactRequestDto } from './dto/filter-contact-request.dto.js';
import { UpdateContactRequestDto } from './dto/update-contact-request.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

@ApiTags('Contact Requests (Admin)')
@AdminOnly()
@Controller('contact-requests')
export class ContactRequestsController {
  constructor(private readonly service: ContactRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar leads de contacto (paginado, filtrable)' })
  @ApiResponse({ status: 200, description: 'data + meta de paginación' })
  findAll(@Query() filters: FilterContactRequestDto) {
    return this.service.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un lead' })
  @ApiResponse({ status: 200, description: 'Lead' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Gestionar lead (estado, asignación, notas)' })
  @ApiResponse({ status: 200, description: 'Lead actualizado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactRequestDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.update(id, dto, userId);
  }
}
