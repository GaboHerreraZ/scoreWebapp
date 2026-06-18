import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AnalysisPacksService } from './analysis-packs.service.js';

/**
 * Consulta de una compra por la referencia de ePayco (x_ref_payco). Pensado para
 * la pantalla de resultado del pago: ePayco redirige al front a
 * /pago/resultado?ref_payco=... y el front consulta aquí. La referencia viaja en
 * la URL, así que sobrevive a refrescos sin depender de memoria/localStorage.
 *
 * No usa @CompanyScoped() porque la ruta no lleva :companyId — el acceso se
 * valida en el service contra la empresa de la bolsa (miembro activo o admin).
 */
@ApiTags('Analysis Packs')
@ApiBearerAuth()
@Controller('analysis-packs/by-reference')
export class AnalysisPacksReferenceController {
  constructor(private readonly service: AnalysisPacksService) {}

  @Get(':refPayco')
  @ApiOperation({
    summary: 'Estado/recibo de una compra por referencia de ePayco (ref_payco)',
  })
  @ApiResponse({
    status: 200,
    description: 'Recibo de la compra: status, empresa, plan, pago y vigencia',
  })
  @ApiResponse({ status: 403, description: 'Sin acceso a esta compra' })
  @ApiResponse({ status: 404, description: 'Referencia no encontrada' })
  getByReference(
    @Param('refPayco') refPayco: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.getStatusByReference(refPayco, userId);
  }
}
