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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { InvitationsService } from './invitations.service.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { RespondInvitationDto } from './dto/respond-invitation.dto.js';
import { FilterInvitationDto } from './dto/filter-invitation.dto.js';
import { AcceptInvitationRegisterDto } from './dto/accept-invitation-register.dto.js';
import { RejectInvitationDto } from './dto/reject-invitation.dto.js';
import { ToggleUserStatusDto } from './dto/toggle-user-status.dto.js';

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('companies/:companyId/invitations')
  @ApiOperation({ summary: 'Send an invitation to collaborate in a company' })
  @ApiResponse({ status: 201, description: 'Invitation created successfully' })
  @ApiResponse({
    status: 403,
    description: 'Maximum users reached for subscription',
  })
  @ApiResponse({
    status: 409,
    description: 'User already in company or pending invitation exists',
  })
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateInvitationDto,
    @Req() req: Request,
  ) {
    const invitedBy = (req as any).user.id as string;
    return this.invitationsService.create(companyId, invitedBy, dto);
  }

  @Get('companies/:companyId/invitations')
  @ApiOperation({ summary: 'List invitations of a company' })
  @ApiResponse({ status: 200, description: 'Paginated list of invitations' })
  findAllByCompany(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterInvitationDto,
  ) {
    return this.invitationsService.findAllByCompany(companyId, filters);
  }

  @Get('invitations/pending/:email')
  @ApiOperation({
    summary: 'Verificar si un email tiene invitaciones pendientes',
  })
  @ApiResponse({ status: 200, description: 'Resultado de la verificación' })
  findPendingByEmail(@Param('email') email: string) {
    return this.invitationsService.findPendingByEmail(email);
  }

  @Public()
  @Get('invitations/:id')
  @ApiOperation({
    summary: 'Obtener una invitación por ID (público, requiere token)',
  })
  @ApiResponse({ status: 200, description: 'Invitación encontrada' })
  @ApiResponse({
    status: 404,
    description: 'Invitación no encontrada o token inválido',
  })
  @ApiResponse({ status: 400, description: 'Invitación expirada' })
  findByIdPublic(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token: string,
  ) {
    return this.invitationsService.findByIdPublic(id, token);
  }

  @Get('users/:userId/invitations')
  @ApiOperation({ summary: 'Listar invitaciones enviadas por un usuario' })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de invitaciones enviadas',
  })
  findAllByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() filters: FilterInvitationDto,
  ) {
    return this.invitationsService.findAllByUser(userId, filters);
  }

  @Patch('invitations/:id/toggle-status')
  @ApiOperation({
    summary: 'Activar o desactivar un usuario invitado en la empresa',
  })
  @ApiResponse({ status: 200, description: 'Estado del usuario actualizado' })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden activar/desactivar invitaciones aceptadas',
  })
  @ApiResponse({ status: 404, description: 'Invitación no encontrada' })
  toggleUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleUserStatusDto,
  ) {
    return this.invitationsService.toggleUserStatus(id, dto.isActive);
  }

  @Patch('invitations/:id/respond')
  @ApiOperation({ summary: 'Accept or reject an invitation' })
  @ApiResponse({
    status: 200,
    description: 'Invitation responded successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Invitation does not belong to you',
  })
  @ApiResponse({ status: 400, description: 'Invitation already responded' })
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondInvitationDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    const userEmail = (req as any).user.email as string;
    return this.invitationsService.respond(id, userId, userEmail, dto);
  }

  @Public()
  @Post('invitations/:id/accept-register')
  @ApiOperation({
    summary: 'Aceptar invitación y registrar perfil del usuario invitado',
  })
  @ApiResponse({
    status: 201,
    description: 'Perfil creado e invitación aceptada',
  })
  @ApiResponse({ status: 400, description: 'Invitación ya respondida' })
  @ApiResponse({ status: 404, description: 'Invitación no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un perfil con este userId o email',
  })
  acceptAndRegister(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptInvitationRegisterDto,
  ) {
    return this.invitationsService.acceptAndRegister(id, dto.userId, dto.token);
  }

  @Public()
  @Post('invitations/:id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Rechazar una invitación (público, requiere token)',
  })
  @ApiResponse({
    status: 204,
    description: 'Invitación rechazada correctamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Invitación ya respondida o expirada',
  })
  @ApiResponse({
    status: 404,
    description: 'Invitación no encontrada o token inválido',
  })
  rejectPublic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectInvitationDto,
  ) {
    return this.invitationsService.rejectPublic(id, dto.token);
  }
}
