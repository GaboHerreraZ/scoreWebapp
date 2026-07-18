import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CustomerAuthorizationsService } from './customer-authorizations.service.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

/**
 * Consulta de solo lectura del estado de la autorización de un titular. Sirve
 * para que el front pregunte "¿ya firmó?" sin disparar la creación del estudio
 * (relanzar from-bureau tras la firma sí lo crea). La SOLICITUD/envío de la
 * autorización NO tiene endpoint propio: se hace dentro de from-bureau cuando el
 * titular aún no ha firmado.
 */
@ApiTags('Autorización del titular')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/customer-authorizations')
export class CustomerAuthorizationsController {
  constructor(private readonly service: CustomerAuthorizationsService) {}

  @Get(':identificationNumber')
  @ApiOperation({
    summary:
      'Estado de la autorización de un titular (por número de identificación)',
  })
  @ApiResponse({
    status: 200,
    description: "Estado de la autorización (o status 'not_requested')",
  })
  getStatus(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('identificationNumber') identificationNumber: string,
  ) {
    return this.service.getStatus(companyId, identificationNumber);
  }
}
