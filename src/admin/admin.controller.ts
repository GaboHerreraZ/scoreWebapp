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

  @Post('companies/onboard')
  @ApiOperation({
    summary:
      'Alta atómica de una empresa: empresa + suscripción PRO con nivel + invitación al dueño',
  })
  @ApiResponse({ status: 201, description: 'Empresa creada e invitación enviada' })
  @ApiResponse({ status: 409, description: 'NIT ya existe' })
  onboard(@Body() dto: OnboardClientDto, @Req() req: Request) {
    const adminUserId = (req as any).user.id as string;
    return this.adminService.onboardClient(dto, adminUserId);
  }

  @Get('companies')
  @ApiOperation({ summary: 'Listar todas las empresas (cross-tenant)' })
  @ApiResponse({ status: 200, description: 'Listado paginado de empresas' })
  listCompanies(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
  ) {
    return this.adminService.listCompanies({
      page: Number(page),
      limit: Number(limit),
      search,
    });
  }

  @Get('companies/:companyId')
  @ApiOperation({ summary: 'Detalle de una empresa' })
  @ApiResponse({ status: 200, description: 'Detalle de la empresa' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  getDetail(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getClientDetail(companyId);
  }

  @Get('companies/:companyId/usage')
  @ApiOperation({ summary: 'Consumo del ciclo actual (estudios usados / cupo)' })
  @ApiResponse({ status: 200, description: 'Consumo del ciclo' })
  getUsage(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getUsage(companyId);
  }

  @Get('companies/:companyId/cycle-activity')
  @ApiOperation({
    summary:
      'Actividad del ciclo actual para soporte: estudios, análisis IA, extracciones PDF y customers creados (campos resumidos)',
  })
  @ApiResponse({ status: 200, description: 'Listado resumido de lo creado en el ciclo' })
  @ApiResponse({ status: 404, description: 'La empresa no tiene suscripción vigente' })
  getCycleActivity(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getCycleActivity(companyId);
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
