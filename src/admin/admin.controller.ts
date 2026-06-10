import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { AdminService } from './admin.service.js';
import { OnboardClientDto } from './dto/onboard-client.dto.js';
import { ChangeTierDto } from './dto/change-tier.dto.js';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('clients/onboard')
  @ApiOperation({
    summary:
      'Alta atómica de un cliente: empresa + suscripción PRO con nivel + invitación al dueño',
  })
  @ApiResponse({ status: 201, description: 'Cliente creado e invitación enviada' })
  @ApiResponse({ status: 409, description: 'NIT ya existe' })
  onboard(@Body() dto: OnboardClientDto, @Req() req: Request) {
    const adminUserId = (req as any).user.id as string;
    return this.adminService.onboardClient(dto, adminUserId);
  }

  @Get('clients')
  @ApiOperation({ summary: 'Listar todos los clientes (cross-tenant)' })
  @ApiResponse({ status: 200, description: 'Listado paginado de clientes' })
  listClients(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
  ) {
    return this.adminService.listClients({
      page: Number(page),
      limit: Number(limit),
      search,
    });
  }

  @Get('clients/:companyId')
  @ApiOperation({ summary: 'Detalle de un cliente' })
  @ApiResponse({ status: 200, description: 'Detalle del cliente' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  getDetail(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getClientDetail(companyId);
  }

  @Get('clients/:companyId/usage')
  @ApiOperation({ summary: 'Consumo del ciclo actual (estudios usados / cupo)' })
  @ApiResponse({ status: 200, description: 'Consumo del ciclo' })
  getUsage(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getUsage(companyId);
  }

  @Get('clients/:companyId/contract-summary')
  @ApiOperation({
    summary: 'Resumen del contrato anual (total comprometido por tramos)',
  })
  @ApiResponse({ status: 200, description: 'Resumen del contrato' })
  getContractSummary(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getContractSummary(companyId);
  }

  @Post('companies/:companyId/subscription/change-tier')
  @ApiOperation({
    summary: 'Cambiar el nivel mensual de estudios (inmediato, reinicia ciclo)',
  })
  @ApiResponse({ status: 201, description: 'Nivel actualizado' })
  @ApiResponse({ status: 404, description: 'Sin suscripción vigente' })
  changeTier(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ChangeTierDto,
  ) {
    return this.adminService.changeTier(companyId, dto);
  }
}
