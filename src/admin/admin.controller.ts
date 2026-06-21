import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { AdminService } from './admin.service.js';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('platform-admins')
  @ApiOperation({
    summary: 'Listar admins activos del portal (para selectores, p.ej. asignar leads)',
  })
  @ApiResponse({
    status: 200,
    description: 'Admins activos con id, name, email, phone y role',
  })
  listPlatformAdmins() {
    return this.adminService.listPlatformAdmins();
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
  @ApiOperation({ summary: 'Detalle de una empresa (saldo de créditos, bolsas, usuarios)' })
  @ApiResponse({ status: 200, description: 'Detalle de la empresa' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  getDetail(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getClientDetail(companyId);
  }

  @Get('companies/:companyId/usage')
  @ApiOperation({ summary: 'Saldo de consultas disponible (créditos de bolsas)' })
  @ApiResponse({ status: 200, description: 'Saldo de créditos y bolsas vigentes' })
  getUsage(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getUsage(companyId);
  }

  @Get('companies/:companyId/cycle-activity')
  @ApiOperation({
    summary:
      'Actividad reciente (30 días) para soporte: estudios, análisis IA, extracciones PDF y customers creados',
  })
  @ApiResponse({ status: 200, description: 'Listado resumido de lo creado en la ventana' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  getCycleActivity(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getCycleActivity(companyId);
  }
}
