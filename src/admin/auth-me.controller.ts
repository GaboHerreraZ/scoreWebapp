import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdminService } from './admin.service.js';

/**
 * Datos del admin autenticado para el portal. Requiere login (el SupabaseAuthGuard
 * global valida el token y pone request.user). El userId se toma del token, no se
 * recibe por parámetro. La verificación de que sea un PlatformAdmin activo (y el
 * 403 si no) la hace el service.
 */
@ApiTags('Auth (Portal)')
@ApiBearerAuth()
@Controller('auth/me')
export class AuthMeController {
  constructor(private readonly adminService: AdminService) {}

  @Get('screens')
  @ApiOperation({
    summary: 'Pantallas permitidas del panel admin según el rol del usuario',
  })
  @ApiResponse({ status: 200, description: 'admin + allowedScreens' })
  @ApiResponse({ status: 403, description: 'No es administrador del portal' })
  getMyScreens(@Req() req: Request) {
    const userId = (req as any).user.id as string;
    return this.adminService.getMyScreens(userId);
  }
}
