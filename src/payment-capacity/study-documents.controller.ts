import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { StudyDocumentsService } from './study-documents.service.js';
import { UploadStudyDocumentDto } from './dto/upload-study-document.dto.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';
import { MAX_PDF_UPLOAD_BYTES } from '../common/constants/upload-limits.js';
import {
  FeatureFlagGuard,
  RequireFeature,
} from '../feature-flags/feature-flag.guard.js';

@ApiTags('Study Documents')
@ApiBearerAuth()
@CompanyScoped()
@Controller('companies/:companyId/credit-studies/:creditStudyId/documents')
export class StudyDocumentsController {
  constructor(private readonly studyDocumentsService: StudyDocumentsService) {}

  @Post()
  // Kill switch: sin flag no entra trabajo nuevo (aquí vive el costo de IA).
  // Ver/listar/descargar quedan libres: lo existente no se rompe.
  @RequireFeature('paymentCapacity')
  @UseGuards(FeatureFlagGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_UPLOAD_BYTES } }),
  )
  @ApiOperation({
    summary:
      'Subir un documento del estudio de capacidad (extracto, desprendible o factura): Storage + extracción IA + validaciones',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF original del documento',
        },
        documentTypeCode: {
          type: 'string',
          enum: ['bankStatement', 'payrollStub', 'contractorInvoice'],
        },
      },
      required: ['file', 'documentTypeCode'],
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Documento procesado: resumen + validaciones + cobertura actualizada del estudio',
  })
  @ApiResponse({
    status: 400,
    description:
      'Archivo inválido, tipo no permitido para el perfil, cardinalidad excedida o extracción fallida',
  })
  @ApiResponse({
    status: 404,
    description: 'Estudio de crédito no encontrado en esta empresa',
  })
  async upload(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadStudyDocumentDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo PDF es requerido');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se aceptan archivos en formato PDF');
    }
    // El mimetype lo declara el cliente según la extensión (un .jpg renombrado
    // a .pdf lo pasa); los bytes mágicos del contenido no se pueden falsear así.
    if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new BadRequestException(
        'El archivo no es un PDF válido. Verifica que no sea una imagen u otro documento renombrado a .pdf',
      );
    }
    const userId = (req as any).user.id as string;

    return this.studyDocumentsService.upload({
      companyId,
      creditStudyId,
      userId,
      documentTypeCode: dto.documentTypeCode,
      fileName: file.originalname,
      fileBuffer: file.buffer,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Listar los documentos del estudio de capacidad + cobertura',
  })
  @ApiResponse({ status: 200, description: 'Documentos y cobertura' })
  @ApiResponse({
    status: 404,
    description: 'Estudio de crédito no encontrado en esta empresa',
  })
  list(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
  ) {
    return this.studyDocumentsService.list(creditStudyId, companyId);
  }

  @Get(':documentId/file')
  @ApiOperation({
    summary: 'URL firmada (1 hora) del PDF original del documento',
  })
  @ApiResponse({ status: 200, description: 'URL firmada del archivo' })
  @ApiResponse({
    status: 404,
    description: 'Documento no encontrado en este estudio',
  })
  getFileUrl(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.studyDocumentsService.getFileUrl(
      documentId,
      creditStudyId,
      companyId,
    );
  }

  @Delete(':documentId')
  @RequireFeature('paymentCapacity')
  @UseGuards(FeatureFlagGuard)
  @ApiOperation({
    summary:
      'Eliminar un documento del estudio (recalcula cobertura y estado del flujo)',
  })
  @ApiResponse({ status: 200, description: 'Documento eliminado' })
  @ApiResponse({
    status: 400,
    description: 'El estudio está confirmado o cerrado',
  })
  @ApiResponse({
    status: 404,
    description: 'Documento no encontrado en este estudio',
  })
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.studyDocumentsService.remove(
      documentId,
      creditStudyId,
      companyId,
    );
  }
}
