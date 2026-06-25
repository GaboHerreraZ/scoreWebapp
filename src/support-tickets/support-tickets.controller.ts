import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SupportTicketsService } from './support-tickets.service.js';
import { FilterSupportTicketDto } from './dto/filter-support-ticket.dto.js';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

@ApiTags('Support Tickets (Admin)')
@AdminOnly()
@Controller('support-tickets')
export class SupportTicketsController {
  constructor(private readonly service: SupportTicketsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar tickets (panel soporte, paginado y filtrable)' })
  @ApiResponse({ status: 200, description: 'data + meta de paginación' })
  findAll(@Query() filters: FilterSupportTicketDto) {
    return this.service.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un ticket' })
  @ApiResponse({ status: 200, description: 'Ticket' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Gestionar ticket (estado, asignación, notas)' })
  @ApiResponse({ status: 200, description: 'Ticket actualizado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    return this.service.update(id, dto);
  }
}
