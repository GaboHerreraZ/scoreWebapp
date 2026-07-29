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
  ParseIntPipe,
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
import { ScoringService } from '../scoring/scoring.service.js';
import { CreateScoringDimensionDto } from '../scoring/dto/create-scoring-dimension.dto.js';
import { UpdateScoringDimensionDto } from '../scoring/dto/update-scoring-dimension.dto.js';
import { CreatePlatformAdminDto } from './dto/create-platform-admin.dto.js';
import { UpdatePlatformAdminDto } from './dto/update-platform-admin.dto.js';
import { CycleActivityDto } from './dto/cycle-activity.dto.js';
import { ResetCreditStudyDto } from './dto/reset-credit-study.dto.js';
import { TestExtractPdfDto } from './dto/test-extract-pdf.dto.js';
import { FilterPdfExtractionTestDto } from './dto/filter-pdf-extraction-test.dto.js';
import { PdfExtractionTestService } from './pdf-extraction-test.service.js';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_PDF_UPLOAD_BYTES,
} from '../common/constants/upload-limits.js';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly scoringService: ScoringService,
    private readonly pdfExtractionTestService: PdfExtractionTestService,
  ) {}

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
    summary:
      'Crear un usuario del portal (Supabase + PlatformAdmin). Solo rol admin.',
  })
  @ApiResponse({ status: 201, description: 'PlatformAdmin creado' })
  @ApiResponse({
    status: 403,
    description: 'Solo un administrador puede crear usuarios',
  })
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
    summary:
      'Editar un usuario del portal (name/phone/roleId). Solo rol admin.',
  })
  @ApiResponse({ status: 200, description: 'PlatformAdmin actualizado' })
  @ApiResponse({
    status: 403,
    description: 'Solo un administrador puede editar usuarios',
  })
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
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } }),
  )
  @ApiOperation({
    summary:
      'Subir/actualizar la foto de un usuario del portal. Solo rol admin.',
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
  @ApiResponse({
    status: 403,
    description: 'Solo un administrador puede reactivar usuarios',
  })
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
    summary:
      'Desactivar un usuario del portal (borrado lógico). Solo rol admin.',
  })
  @ApiResponse({ status: 200, description: 'PlatformAdmin desactivado' })
  @ApiResponse({
    status: 403,
    description: 'Solo un administrador puede desactivar usuarios',
  })
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
  @ApiOperation({
    summary:
      'Ficha completa de una empresa: identidad, ubicación, sector, cuenta bancaria, facturación, contrato macro, scoring configurado, semáforo de setup + créditos, bolsas y usuarios',
  })
  @ApiResponse({
    status: 200,
    description: 'company, contract, scoring, setup, credits, packs, users',
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  getDetail(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getClientDetail(companyId);
  }

  @Get('companies/:companyId/usage')
  @ApiOperation({
    summary:
      'Salud de la cuenta: saldo de créditos, ritmo de consumo con proyección de agotamiento, créditos por vencer y desglose por usuario',
  })
  @ApiResponse({
    status: 200,
    description:
      'credits, consumption (ritmo/proyección/byUser), lifetime, customers',
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  getUsage(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.adminService.getUsage(companyId);
  }

  @Get('companies/:companyId/cycle-activity')
  @ApiOperation({
    summary:
      'Actividad reciente para soporte: summary + estudios (veredicto/atascados), consultas a la central (fallos), análisis IA (costo/errores) y customers creados. ?windowDays ajusta la ventana (default 30)',
  })
  @ApiResponse({
    status: 200,
    description: 'window, summary y listas de la ventana',
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  getCycleActivity(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() dto: CycleActivityDto,
  ) {
    return this.adminService.getCycleActivity(companyId, dto.windowDays);
  }

  @Post('credit-studies/:id/reset')
  @ApiOperation({
    summary:
      'Resetear un estudio al paso 2 (re-carga de EEFF) con snapshot de auditoría',
    description:
      'Para tickets por datos mal leídos en la extracción: congela el estado previo (resultado + análisis financieros) en credit_study_resets con ticket y motivo, borra los análisis congelados del estudio (la re-carga no duplica fuentes), limpia el resultado y regresa el estado a pendingFinancialStatements. La consulta al bureau se reutiliza: re-analizar no consume bolsa.',
  })
  @ApiResponse({ status: 201, description: 'Estudio reseteado + resetId' })
  @ApiResponse({
    status: 400,
    description: 'Estudio confirmado/en firma/cerrado (no reseteable)',
  })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado' })
  resetCreditStudy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetCreditStudyDto,
    @Req() req: Request,
  ) {
    const adminUserId = (req as any).user.id as string;
    return this.adminService.resetCreditStudy(id, dto, adminUserId);
  }

  @Get('credit-study-resets')
  @ApiOperation({
    summary:
      'Listar los resets de estudio (auditoría), del más reciente al más antiguo',
    description:
      'Datos mínimos por fila: empresa, cliente y solicitud del estudio (con su estado ACTUAL, para ver si ya se re-analizó), ticket (referencia, asunto, descripción), motivo y admin que lo ejecutó. El snapshot completo se sirve en el detalle por id.',
  })
  @ApiResponse({ status: 200, description: 'Listado de resets' })
  listCreditStudyResets() {
    return this.adminService.listCreditStudyResets();
  }

  @Get('credit-study-resets/:id')
  @ApiOperation({
    summary:
      'Detalle de un reset: snapshot completo del estado previo + antes/después',
    description:
      'Incluye el snapshot congelado al resetear (viability*, status previo, solicitud y los análisis financieros desechados con períodos/indicadores/red flags), el previousStatus, el ticket asociado y el estado actual del estudio para contrastar.',
  })
  @ApiResponse({ status: 200, description: 'Detalle del reset con snapshot' })
  @ApiResponse({ status: 404, description: 'Reset no encontrado' })
  getCreditStudyReset(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getCreditStudyReset(id);
  }

  // ── Banco de pruebas de la extracción de PDF ───────────────────────────────

  @Post('pdf-extraction-test')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_UPLOAD_BYTES } }),
  )
  @ApiOperation({
    summary:
      'Probar la extracción IA de un PDF de estados financieros SIN guardar nada',
    description:
      'Corre la misma cadena del flujo real (extracción IA → normalización de períodos → indicadores y ratios) pero no persiste nada: ni la corrida de IA, ni el PDF, ni períodos, ni análisis, y no consume bolsa de ningún cliente. Devuelve los períodos leídos (uno por año, más reciente primero), los indicadores y ratios calculados sobre los dos períodos más recientes, las red flags de fiabilidad y el consumo de la corrida (tokens y costo estimado).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF con los estados financieros',
        },
        incomeStatementId: { type: 'number', example: 1 },
        fiscalYear: { type: 'number', example: 2024 },
        includeRaw: { type: 'boolean', example: false },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'id, fileName, createdAt, period, periods, indicators, ratios, reliabilityFlags, usage',
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo inválido o extracción fallida',
  })
  testPdfExtraction(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: TestExtractPdfDto,
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

    const adminUserId = (req as any).user.id as string;
    return this.pdfExtractionTestService.testExtraction(file, dto, adminUserId);
  }

  @Get('pdf-extraction-tests')
  @ApiOperation({
    summary:
      'Listar las corridas archivadas del banco de pruebas, de la más reciente a la más antigua',
    description:
      'Fila liviana para elegir cuál abrir: archivo, contexto, modelo, consumo y conteos. No incluye el JSON de la corrida ni el texto crudo (esos van en el detalle). ?search filtra por nombre del PDF.',
  })
  @ApiResponse({ status: 200, description: 'data + meta (paginado)' })
  listPdfExtractionTests(@Query() filters: FilterPdfExtractionTestDto) {
    return this.pdfExtractionTestService.findAll(filters);
  }

  @Get('pdf-extraction-tests/:id')
  @ApiOperation({
    summary: 'Detalle de una corrida archivada (sin re-procesar el PDF)',
    description:
      'Devuelve el response completo tal cual se generó el día de la corrida (period, periods, indicators, ratios, reliabilityFlags, usage) más el texto crudo del modelo.',
  })
  @ApiResponse({ status: 200, description: 'Corrida archivada completa' })
  @ApiResponse({ status: 404, description: 'Corrida no encontrada' })
  getPdfExtractionTest(@Param('id', ParseUUIDPipe) id: string) {
    return this.pdfExtractionTestService.findById(id);
  }

  @Delete('pdf-extraction-tests/:id')
  @ApiOperation({
    summary: 'Borrar una corrida archivada (limpieza del banco de pruebas)',
  })
  @ApiResponse({ status: 200, description: 'Corrida borrada' })
  @ApiResponse({ status: 404, description: 'Corrida no encontrada' })
  deletePdfExtractionTest(@Param('id', ParseUUIDPipe) id: string) {
    return this.pdfExtractionTestService.remove(id);
  }

  // ── Catálogo de dimensiones de scoring (scoring_dimensions) ────────────────
  // Solo el portal admin administra el catálogo: crear, editar lo básico
  // (label/description/orden) y activar/desactivar. Sin borrado físico. Los
  // clientes lo LEEN por GET /scoring-dimensions (fuera de /admin).

  @Get('scoring-dimensions')
  @ApiOperation({
    summary:
      'Catálogo completo de dimensiones de scoring (activas e inactivas)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Dimensiones con reglas del motor (required, appliesTo, supported)',
  })
  listScoringDimensions() {
    return this.scoringService.listDimensions(true);
  }

  @Post('scoring-dimensions')
  @ApiOperation({
    summary:
      'Crear una dimensión en el catálogo. El code debe estar soportado por el motor (su lógica de evaluación se despliega primero).',
  })
  @ApiResponse({ status: 201, description: 'Dimensión creada' })
  @ApiResponse({ status: 400, description: 'Code no soportado por el motor' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una dimensión con ese code',
  })
  createScoringDimension(@Body() dto: CreateScoringDimensionDto) {
    return this.scoringService.createDimension(dto);
  }

  @Patch('scoring-dimensions/:id')
  @ApiOperation({
    summary:
      'Editar lo básico de una dimensión (label/description/orden) o activarla/desactivarla (eliminación lógica). El code no es editable y no hay borrado físico.',
  })
  @ApiResponse({ status: 200, description: 'Dimensión actualizada' })
  @ApiResponse({
    status: 400,
    description: 'Una dimensión obligatoria del motor no puede desactivarse',
  })
  @ApiResponse({ status: 404, description: 'Dimensión no encontrada' })
  updateScoringDimension(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScoringDimensionDto,
  ) {
    return this.scoringService.updateDimension(id, dto);
  }
}
