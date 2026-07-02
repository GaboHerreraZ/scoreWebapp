import { IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { BLOG_STATUSES } from './create-blog-post.dto.js';

/**
 * Filtros del listado. `limit` por defecto 9 (grid del blog). El filtro `status`
 * SOLO aplica al listado admin; el listado público ignora cualquier status
 * recibido y fuerza 'published' en el servicio.
 */
export class FilterBlogPostDto extends PaginationDto {
  @ApiPropertyOptional({ default: 9 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 9;

  @ApiPropertyOptional({ description: 'Filtrar por categoría (code)' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado (code). Solo admin.',
    enum: BLOG_STATUSES,
  })
  @IsOptional()
  @IsIn(BLOG_STATUSES)
  status?: string;

  @ApiPropertyOptional({ description: 'Filtrar por etiqueta' })
  @IsOptional()
  @IsString()
  tag?: string;
}
