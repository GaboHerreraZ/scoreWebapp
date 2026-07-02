import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BlogService } from './blog.service.js';
import { FilterBlogPostDto } from './dto/filter-blog-post.dto.js';
import { Public } from '../common/decorators/public.decorator.js';

/**
 * API pública del blog. @Public() salta la auth global. Solo expone artículos
 * con status='published'; el service nunca devuelve draft/archived aquí.
 *
 * Las categorías NO tienen endpoint propio: el front las obtiene de
 * GET /api/parameters?type=blog_category.
 */
@ApiTags('Blog (Público)')
@Controller('blog')
export class BlogPublicController {
  constructor(private readonly service: BlogService) {}

  @Get()
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Listar artículos publicados (paginado)' })
  @ApiResponse({ status: 200, description: 'data + meta de paginación' })
  findAll(@Query() filters: FilterBlogPostDto) {
    return this.service.findAllPublic(filters);
  }

  @Get(':slug')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Detalle de un artículo por slug' })
  @ApiResponse({ status: 200, description: 'Artículo publicado' })
  @ApiResponse({ status: 404, description: 'No encontrado o no publicado' })
  findOne(@Param('slug') slug: string) {
    return this.service.findOneBySlugPublic(slug);
  }
}
