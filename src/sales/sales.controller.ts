import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { SalesService } from './sales.service.js';
import { SalesCommissionsService } from './sales-commissions.service.js';
import { CreateSalesRepDto } from './dto/create-sales-rep.dto.js';
import { UpdateSalesRepDto } from './dto/update-sales-rep.dto.js';
import { CreateCommissionPlanDto } from './dto/create-commission-plan.dto.js';
import { AssignReferralDto } from './dto/assign-referral.dto.js';
import {
  FilterCommissionDto,
  FilterCommissionSummaryDto,
} from './dto/filter-commission.dto.js';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto.js';

/**
 * Programa de referidos. Lo consumen dos perfiles del portal:
 *  - 'admin': gestiona vendedores, plan y vinculaciones; ve todas las comisiones.
 *  - 'sales': solo consulta LO SUYO (sus empresas y sus ganancias).
 *
 * El AdminGuard deja pasar a cualquier PlatformAdmin activo; el alcance fino lo
 * resuelve cada service a partir del caller.
 */
@ApiTags('Sales (Programa de referidos)')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly commissionsService: SalesCommissionsService,
  ) {}

  private userId(req: Request): string {
    return (req as any).user.id as string;
  }

  private caller(req: Request) {
    return this.salesService.resolveCaller(this.userId(req));
  }

  // ── Plan de comisiones ────────────────────────────────────────────────

  @Get('commission-plan')
  @ApiOperation({ summary: 'Plan de comisiones vigente (los dos porcentajes)' })
  @ApiResponse({ status: 200, description: 'Plan vigente' })
  @ApiResponse({ status: 404, description: 'No hay plan configurado' })
  getActivePlan() {
    return this.salesService.getActivePlan();
  }

  @Get('commission-plans')
  @ApiOperation({ summary: 'Historial de versiones del plan (solo admin)' })
  async listPlans(@Req() req: Request) {
    return this.salesService.listPlans(await this.caller(req));
  }

  @Post('commission-plans')
  @ApiOperation({
    summary:
      'Publicar una versión nueva del plan (desactiva la anterior; no reescribe lo causado)',
  })
  @ApiResponse({ status: 201, description: 'Plan publicado' })
  async publishPlan(@Body() dto: CreateCommissionPlanDto, @Req() req: Request) {
    return this.salesService.publishPlan(dto, await this.caller(req));
  }

  // ── Vendedores ────────────────────────────────────────────────────────

  @Get('reps')
  @ApiOperation({ summary: 'Listar vendedores del programa (solo admin)' })
  @ApiQuery({ name: 'onlyActive', required: false, type: Boolean })
  async listReps(
    @Req() req: Request,
    @Query('onlyActive') onlyActive?: string,
  ) {
    return this.salesService.listReps(
      await this.caller(req),
      onlyActive === 'true',
    );
  }

  @Post('reps')
  @ApiOperation({
    summary:
      'Dar de alta como vendedor a un usuario del portal con rol sales (solo admin)',
  })
  @ApiResponse({ status: 201, description: 'Vendedor creado' })
  @ApiResponse({ status: 400, description: 'El usuario no tiene rol sales' })
  @ApiResponse({
    status: 409,
    description: 'Ya es vendedor o el código existe',
  })
  async createRep(@Body() dto: CreateSalesRepDto, @Req() req: Request) {
    return this.salesService.createRep(dto, await this.caller(req));
  }

  @Get('reps/:id')
  @ApiOperation({ summary: 'Detalle de un vendedor' })
  async findRep(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.salesService.findRep(id, await this.caller(req));
  }

  @Patch('reps/:id')
  @ApiOperation({ summary: 'Editar código / estado / nota (solo admin)' })
  async updateRep(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesRepDto,
    @Req() req: Request,
  ) {
    return this.salesService.updateRep(id, dto, await this.caller(req));
  }

  @Get('reps/:id/companies')
  @ApiOperation({ summary: 'Empresas que trajo un vendedor (su cartera)' })
  async listRepReferrals(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.salesService.listRepReferrals(id, await this.caller(req));
  }

  // ── Vinculación empresa ↔ vendedor ────────────────────────────────────

  @Get('referrals/company/:companyId')
  @ApiOperation({
    summary: 'Vendedor que recomendó a una empresa (null si fue venta directa)',
  })
  async getCompanyReferral(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() req: Request,
  ) {
    return this.salesService.getCompanyReferral(
      companyId,
      await this.caller(req),
    );
  }

  @Get('referrals/company/:companyId/backlog-preview')
  @ApiOperation({
    summary:
      'Comisiones que se causarían al vincular esta empresa, sin escribir nada',
  })
  async previewBacklog(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() req: Request,
  ) {
    return this.salesService.previewReferralBacklog(
      companyId,
      await this.caller(req),
    );
  }

  @Put('referrals/company/:companyId')
  @ApiOperation({
    summary:
      'Vincular o reasignar la empresa al vendedor de un código (solo admin, ' +
      'dentro de la ventana). Causa las compras ya pagadas sin comisionar.',
  })
  @ApiResponse({ status: 200, description: 'Empresa vinculada' })
  @ApiResponse({ status: 404, description: 'Empresa o código inexistente' })
  @ApiResponse({ status: 409, description: 'La ventana de asignación venció' })
  async assignReferral(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AssignReferralDto,
    @Req() req: Request,
  ) {
    return this.salesService.assignReferral(
      companyId,
      dto,
      await this.caller(req),
    );
  }

  @Delete('referrals/company/:companyId')
  @ApiOperation({
    summary: 'Desvincular (solo si la empresa aún no causó comisiones)',
  })
  @ApiResponse({ status: 409, description: 'Ya causó comisiones: reasigna' })
  async removeReferral(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() req: Request,
  ) {
    return this.salesService.removeReferral(companyId, await this.caller(req));
  }

  // ── Comisiones ────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({
    summary:
      'Resumen del vendedor logueado (mes en curso, acumulado, pendiente)',
  })
  async mySummary(@Req() req: Request) {
    return this.commissionsService.mySummary(await this.caller(req));
  }

  @Get('commissions/summary')
  @ApiOperation({
    summary:
      'Ganancias mes a mes. El admin ve a todos los vendedores; un vendedor, solo las suyas.',
  })
  async monthlySummary(
    @Query() filters: FilterCommissionSummaryDto,
    @Req() req: Request,
  ) {
    return this.commissionsService.monthlySummary(
      filters,
      await this.caller(req),
    );
  }

  @Get('commissions')
  @ApiOperation({ summary: 'Ledger de comisiones (paginado y filtrable)' })
  async findCommissions(
    @Query() filters: FilterCommissionDto,
    @Req() req: Request,
  ) {
    return this.commissionsService.findCommissions(
      filters,
      await this.caller(req),
    );
  }

  @Patch('commissions/:id/status')
  @ApiOperation({
    summary: 'Liquidar, revertir o anular una comisión (solo admin)',
  })
  async updateCommissionStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommissionStatusDto,
    @Req() req: Request,
  ) {
    return this.commissionsService.updateStatus(
      id,
      dto,
      await this.caller(req),
    );
  }
}
