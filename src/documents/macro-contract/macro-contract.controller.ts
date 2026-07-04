import { Controller, Post, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { MacroContractService } from './macro-contract.service.js';
import { CompanyScoped } from '../../common/decorators/company-scoped.decorator.js';

@ApiTags('Contrato macro')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/contract')
export class MacroContractController {
  constructor(private readonly service: MacroContractService) {}

  @Post('resend')
  @ApiOperation({
    summary:
      'Enviar/reenviar el contrato macro a la empresa para firma (idempotente: uno por empresa)',
  })
  @ApiResponse({
    status: 201,
    description: 'Contrato enviado (o ya existente); devuelve el estado',
  })
  @ApiResponse({ status: 400, description: 'Falta configuración o datos de la empresa' })
  async resend(@Param('companyId', ParseUUIDPipe) companyId: string) {
    await this.service.sendContractForCompany(companyId);
    return this.service.getContractStatus(companyId);
  }

  @Get()
  @ApiOperation({ summary: 'Estado del contrato macro de la empresa' })
  @ApiResponse({ status: 200, description: 'Estado del contrato (o null si no existe)' })
  getStatus(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.service.getContractStatus(companyId);
  }

  @Get('download')
  @ApiOperation({
    summary:
      'URL fresca del PDF firmado (se pide a Zapsign en el momento; expira ~60 min)',
  })
  @ApiResponse({ status: 200, description: '{ url } o { url: null } si no está firmado' })
  async download(@Param('companyId', ParseUUIDPipe) companyId: string) {
    const url = await this.service.getSignedContractUrl(companyId);
    return { url };
  }
}
