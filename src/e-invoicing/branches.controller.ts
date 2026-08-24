import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { EInvoiceItemsService } from './einvoice-items.service.js';

/**
 * Sucursales del facturador, SOLO LECTURA.
 *
 * Va aparte del panel de facturación a propósito: las sucursales las consulta
 * cualquier rol del portal para saber desde dónde se emite, mientras que emitir
 * y configurar el catálogo es trabajo del financiero. Este controller no expone
 * ni un POST: crear o editar sucursales se hace en el portal del facturador.
 *
 * El AdminGuard sigue aplicando — hay que ser un administrador activo del
 * portal, sin importar el rol.
 */
@ApiTags('Sucursales')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/branches')
export class BranchesController {
  constructor(private readonly itemsService: EInvoiceItemsService) {}

  @Get()
  @ApiOperation({
    summary: 'Sucursales configuradas en el facturador',
    description:
      'Consulta en vivo contra el facturador; no hay copia local. `isDefault` marca la que se usa al emitir cuando no se fija ALIADDO_BRANCH_ID, y `statusLabel` es el estado crudo tal como él lo reporta.',
  })
  @ApiResponse({
    status: 200,
    description:
      'ref, name, isDefault, isEnabled y statusLabel de cada sucursal',
  })
  @ApiResponse({
    status: 503,
    description: 'No se pudo contactar al facturador',
  })
  list() {
    return this.itemsService.listProviderBranches();
  }
}
