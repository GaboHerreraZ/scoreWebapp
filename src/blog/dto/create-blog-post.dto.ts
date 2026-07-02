import {
  IsString,
  IsOptional,
  IsUUID,
  IsUrl,
  IsInt,
  IsArray,
  IsIn,
  IsDateString,
  Matches,
  Min,
  MaxLength,
  MinLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Estados del ciclo de vida de un artículo (codes del Parameter 'blog_status'). */
export const BLOG_STATUSES = ['draft', 'published', 'archived'] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

/**
 * En multipart/form-data los campos llegan como string, así que `tags` viaja
 * como un JSON string (p.ej. '["cupo","pymes"]'). Lo parseamos a array antes de
 * validar. Un array ya formado (JSON body) o un valor vacío pasan sin tocar.
 */
export function parseTags(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw new BadRequestException(
        'tags debe ser un JSON de array de strings (p.ej. ["cupo","pymes"])',
      );
    }
  }
  return value;
}

/**
 * Payload de creación de un artículo (panel admin). category y status son codes
 * de Parameter ('blog_category' / 'blog_status'); el servicio los resuelve a su
 * id. author por defecto es el admin del token (authorId opcional para overridear).
 */
export class CreateBlogPostDto {
  @ApiProperty({
    description: 'Clave única de la URL (kebab-case)',
    example: 'como-definir-cupo-de-credito',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug debe ser kebab-case (minúsculas, números y guiones)',
  })
  slug!: string;

  @ApiProperty({ description: 'Título del artículo' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiProperty({ description: 'Contenido HTML del artículo' })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiProperty({
    description: 'Categoría (code del Parameter blog_category)',
    example: 'analisis-de-credito',
  })
  @IsString()
  category!: string;

  @ApiPropertyOptional({ description: 'Resumen corto (tarjeta / SEO)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @ApiPropertyOptional({
    description: 'PlatformAdmin autor (por defecto el admin del token)',
  })
  @IsOptional()
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional({ description: 'Minutos estimados de lectura' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  readingMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Etiquetas. En multipart, enviar como JSON string: \'["cupo","pymes"]\'',
    example: ['cupo', 'capacidad de pago', 'pymes'],
  })
  @IsOptional()
  @Transform(({ value }) => parseTags(value))
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Estado (code de blog_status). Por defecto draft.',
    enum: BLOG_STATUSES,
  })
  @IsOptional()
  @IsIn(BLOG_STATUSES)
  status?: BlogStatus;

  @ApiPropertyOptional({
    description:
      'Fecha de publicación (ISO). Si status=published y no se envía, se usa la fecha actual.',
  })
  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @ApiPropertyOptional({ description: 'Meta título (SEO)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  metaTitle?: string;

  @ApiPropertyOptional({ description: 'Meta descripción (SEO)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;

  @ApiPropertyOptional({
    description:
      'URL de la fuente/artículo original (cuando se escribe a partir de otro contenido)',
    example: 'https://www.eltiempo.com/economia/...',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  sourceUrl?: string;
}
