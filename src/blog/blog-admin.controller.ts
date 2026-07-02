import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { BlogService } from './blog.service.js';
import { CreateBlogPostDto } from './dto/create-blog-post.dto.js';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto.js';
import { FilterBlogPostDto } from './dto/filter-blog-post.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

const COVER_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const COVER_MAX_SIZE = 2 * 1024 * 1024; // 2MB

/** Valida la portada si vino (opcional). Mismos límites que logo/avatar. */
function validateCover(file?: Express.Multer.File) {
  if (!file) return;
  if (!COVER_ALLOWED_MIMES.includes(file.mimetype)) {
    throw new BadRequestException(
      'Tipo de archivo inválido para la portada. Permitidos: PNG, JPG, WEBP',
    );
  }
  if (file.size > COVER_MAX_SIZE) {
    throw new BadRequestException('La portada no debe exceder 2MB');
  }
}

/**
 * Gestión de artículos del blog (portal admin). Todos los estados son visibles.
 * El "borrado" es suave: DELETE pasa el artículo a status='archived'.
 *
 * Crear/actualizar son multipart/form-data: los campos del artículo van como
 * texto (tags como JSON string) y la portada como archivo opcional 'cover'.
 */
@ApiTags('Blog (Admin)')
@AdminOnly()
@Controller('admin/blog')
export class BlogAdminController {
  constructor(private readonly service: BlogService) {}

  @Get()
  @ApiOperation({ summary: 'Listar artículos (todos los estados, filtrable)' })
  @ApiResponse({ status: 200, description: 'data + meta de paginación' })
  findAll(@Query() filters: FilterBlogPostDto) {
    return this.service.findAllAdmin(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un artículo por id' })
  @ApiResponse({ status: 200, description: 'Artículo' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneAdmin(id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('cover'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Crear un artículo (multipart; portada opcional en campo "cover")',
  })
  @ApiResponse({ status: 201, description: 'Artículo creado' })
  @ApiResponse({ status: 400, description: 'Portada inválida' })
  @ApiResponse({ status: 409, description: 'slug duplicado' })
  create(
    @Body() dto: CreateBlogPostDto,
    @UploadedFile() cover: Express.Multer.File,
    @Req() req: Request,
  ) {
    validateCover(cover);
    const userId = (req as any).user.id as string;
    return this.service.create(dto, userId, cover);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('cover'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Actualizar un artículo (multipart; nueva portada opcional en "cover")',
  })
  @ApiResponse({ status: 200, description: 'Artículo actualizado' })
  @ApiResponse({ status: 400, description: 'Portada inválida' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  @ApiResponse({ status: 409, description: 'slug duplicado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogPostDto,
    @UploadedFile() cover: Express.Multer.File,
    @Req() req: Request,
  ) {
    validateCover(cover);
    const userId = (req as any).user.id as string;
    return this.service.update(id, dto, userId, cover);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archivar un artículo (borrado suave)' })
  @ApiResponse({ status: 200, description: 'Artículo archivado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.archive(id);
  }
}
