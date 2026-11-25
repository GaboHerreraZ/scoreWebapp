import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CustomerAuthorizationsService } from './customer-authorizations.service.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';
import {
  MAX_AUTHORIZATION_PDF_BYTES,
  MAX_PDF_UPLOAD_BYTES,
} from '../common/constants/upload-limits.js';

/**
 * Estado de la autorización de un titular y carga del documento ya firmado.
 *
 * La SOLICITUD/envío de la autorización no tiene endpoint propio: se hace dentro
 * de from-bureau / bureau-checks cuando el titular aún no ha firmado. Lo que sí
 * tiene endpoint es la vía alterna: muchas empresas ya cuentan con la
 * autorización firmada de su cliente y prefieren adjuntarla en vez de volver a
 * pedirle la firma (POST :identificationNumber/signed-document).
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

  /**
   * El interceptor corta en MAX_PDF_UPLOAD_BYTES y el tope real (10 MB) se valida
   * abajo, para responder un 400 en español en vez del 413 en inglés de multer.
   */
  @Post(':identificationNumber/signed-document')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Carga el PDF de la autorización que el titular ya firmó fuera de la plataforma',
  })
  @ApiResponse({
    status: 201,
    description:
      'Autorización marcada como firmada, con el enlace temporal al documento cargado',
  })
  uploadSignedDocument(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('identificationNumber') identificationNumber: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo PDF es requerido');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se aceptan archivos en formato PDF');
    }
    if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new BadRequestException(
        'El archivo no es un PDF válido. Verifica que no sea una imagen u otro documento renombrado a .pdf',
      );
    }
    if (file.size > MAX_AUTHORIZATION_PDF_BYTES) {
      throw new BadRequestException('El archivo no debe exceder 10 MB');
    }

    const userId = (req as unknown as { user: { id: string } }).user.id;
    return this.service.uploadSignedDocument(
      companyId,
      userId,
      identificationNumber,
      file,
    );
  }
}
