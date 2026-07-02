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
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { AdminService } from './admin.service.js';
import { CreatePlatformAdminDto } from './dto/create-platform-admin.dto.js';
import { UpdatePlatformAdminDto } from './dto/update-platform-admin.dto.js';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('platform-admins')
  @ApiOperation({
    summary:
      'Listar usuarios del portal. Por defecto todos (activos e inactivos); ?onlyActive=true para solo activos',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuarios con id, name, email, phone, isActive y role',
  })
  listPlatformAdmins(@Query('onlyActive') onlyActive?: string) {
    return this.adminService.listPlatformAdmins(onlyActive === 'true');
  }

  @Post('platform-admins')
  @ApiOperation({
    summary: 'Crear un usuario del portal (Supabase + PlatformAdmin). Solo rol admin.',
  })
  @ApiResponse({ status: 201, description: 'PlatformAdmin creado' })
  @ApiResponse({ status: 403, description: 'Solo un administrador puede crear usuarios' })
  @ApiResponse({ status: 409, description: 'El correo ya está registrado' })
  createPlatformAdmin(
    @Body() dto: CreatePlatformAdminDto,
    @Req() req: Request,
  ) {
    const callerUserId = (req as any).user.id as string;
    return this.adminService.createPlatformAdmin(dto, callerUserId);
  }

  @Patch('platform-admins/:id')
  @ApiOperation({
    summary: 'Editar un usuario del portal (name/phone/roleId). Solo rol admin.',
  })
  @ApiResponse({ status: 200, description: 'PlatformAdmin actualizado' })
  @ApiResponse({ status: 403, description: 'Solo un administrador puede editar usuarios' })
  @ApiResponse({ status: 404, description: 'Administrador no encontrado' })
  updatePlatformAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformAdminDto,
    @Req() req: Request,
  ) {
    const callerUserId = (req as any).user.id as string;
    return this.adminService.updatePlatformAdmin(id, dto, callerUserId);
  }

  @Patch('platform-admins/:id/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @ApiOperation({
    summary: 'Subir/actualizar la foto de un usuario del portal. Solo rol admin.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
          description: 'Imagen (PNG, JPG, WEBP) máx. 2MB',
        },
      },
      required: ['avatar'],
    },
  })
  @ApiResponse({ status: 200, description: 'Avatar actualizado' })
  @ApiResponse({ status: 400, description: 'Archivo inválido' })
  @ApiResponse({ status: 404, description: 'Administrador no encontrado' })
  uploadPlatformAdminAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo de avatar es requerido');
    }

    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de archivo inválido. Permitidos: PNG, JPG, WEBP',
      );
    }

    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      throw new BadRequestException(
        'El tamaño del archivo no debe exceder 2MB',
      );
    }

    const callerUserId = (req as any).user.id as string;
    return this.adminService.uploadAvatar(id, file, callerUserId);
  }

  @Patch('platform-admins/:id/activate')
  @ApiOperation({
    summary: 'Reactivar un usuario del portal desactivado. Solo rol admin.',
  })
  @ApiResponse({ status: 200, description: 'PlatformAdmin reactivado' })
  @ApiResponse({ status: 403, description: 'Solo un administrador puede reactivar usuarios' })
  @ApiResponse({ status: 404, description: 'Administrador no encontrado' })
  activatePlatformAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const callerUserId = (req as any).user.id as string;
    return this.adminService.activatePlatformAdmin(id, callerUserId);
  }

  @Delete('platform-admins/:id')
  @ApiOperation({
    summary: 'Desactivar un usuario del portal (borrado lógico). Solo rol admin.',
  })
  @ApiResponse({ status: 200, description: 'PlatformAdmin desactivado' })
  @ApiResponse({ status: 403, description: 'Solo un administrador puede desactivar usuarios' })
  @ApiResponse({ status: 404, description: 'Administrador no encontrado' })
  deactivatePlatformAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const callerUserId = (req as any).user.id as string;
    return this.adminService.deactivatePlatformAdmin(id, callerUserId);
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
