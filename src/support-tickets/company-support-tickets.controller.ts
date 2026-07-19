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
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SupportTicketsService } from './support-tickets.service.js';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto.js';
import { FilterSupportTicketDto } from './dto/filter-support-ticket.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

/**
 * Tickets de soporte desde la cuenta del cliente. Company-scoped: valida acceso
 * a la empresa. El ticket se crea a nombre del usuario logueado (createdBy del
 * token); companyId viene de la ruta.
 */
@ApiTags('Support Tickets (Company)')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/support-tickets')
export class CompanySupportTicketsController {
  constructor(private readonly service: SupportTicketsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un ticket de soporte' })
  @ApiResponse({
    status: 201,
    description: '{ id, reference, status, createdAt }',
  })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateSupportTicketDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.create(companyId, dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Historial de tickets de la empresa (paginado)' })
  @ApiResponse({ status: 200, description: 'data + meta de paginación' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterSupportTicketDto,
  ) {
    return this.service.findByCompany(companyId, filters);
  }
}
