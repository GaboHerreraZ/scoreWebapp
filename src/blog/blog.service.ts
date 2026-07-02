import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { BlogRepository } from './blog.repository.js';
import { CreateBlogPostDto } from './dto/create-blog-post.dto.js';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto.js';
import { FilterBlogPostDto } from './dto/filter-blog-post.dto.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { Prisma } from '../../generated/prisma/client.js';

const BLOG_CATEGORY_TYPE = 'blog_category';
const BLOG_STATUS_TYPE = 'blog_status';
// Bucket PÚBLICO de portadas del blog (URL directa, sin firmar).
const BLOG_COVER_BUCKET = 'blog-covers';

// Fila con el include del repositorio (category/status/author).
type BlogPostWithRelations = Awaited<ReturnType<BlogRepository['create']>>;

@Injectable()
export class BlogService {
  constructor(
    private readonly repository: BlogRepository,
    private readonly supabaseService: SupabaseService,
  ) {}

  // ── Público ────────────────────────────────────────────────────────────

  /**
   * Listado público: SIEMPRE fuerza status='published' (ignora cualquier status
   * del cliente). Orden por publishedAt desc. Devuelve items sin `content`.
   */
  async findAllPublic(filters: FilterBlogPostDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 9;

    const publishedId = await this.getStatusId('published');
    const where: Prisma.BlogPostWhereInput = { statusId: publishedId };

    await this.applyCategoryFilter(where, filters.category);
    this.applyTagFilter(where, filters.tag);
    this.applySearchFilter(where, filters.search);

    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
      orderBy: { publishedAt: 'desc' },
    });

    return {
      data: data.map((p) => this.toListItem(p)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Detalle público por slug: 404 si no existe o si no está 'published'. */
  async findOneBySlugPublic(slug: string) {
    const post = await this.repository.findBySlugWithRelations(slug);
    if (!post || post.status.code !== 'published') {
      throw new NotFoundException(`Artículo "${slug}" no encontrado`);
    }
    return this.toDetail(post);
  }

  // ── Admin ──────────────────────────────────────────────────────────────

  /** Listado admin: todos los estados, filtrable por status/category/tag/search. */
  async findAllAdmin(filters: FilterBlogPostDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 9;

    const where: Prisma.BlogPostWhereInput = {};
    if (filters.status) {
      where.statusId = await this.getStatusId(filters.status);
    }
    await this.applyCategoryFilter(where, filters.category);
    this.applyTagFilter(where, filters.tag);
    this.applySearchFilter(where, filters.search);

    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: data.map((p) => this.toDetail(p)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Detalle admin por id (cualquier estado). */
  async findOneAdmin(id: string) {
    const post = await this.repository.findById(id);
    if (!post) {
      throw new NotFoundException(`Artículo con id=${id} no encontrado`);
    }
    return this.toDetail(post);
  }

  /**
   * Crea un artículo. Resuelve category/status a su id de Parameter, valida
   * unicidad de slug y existencia del autor. Si nace 'published' sin publishedAt,
   * usa la fecha actual.
   */
  async create(
    dto: CreateBlogPostDto,
    tokenUserId: string,
    coverFile?: Express.Multer.File,
  ) {
    const existing = await this.repository.findBySlug(dto.slug);
    if (existing) {
      throw new ConflictException(
        `Ya existe un artículo con slug="${dto.slug}"`,
      );
    }

    const categoryId = await this.getCategoryId(dto.category);
    const statusCode = dto.status ?? 'draft';
    const statusId = await this.getStatusId(statusCode);
    const authorId = await this.resolveAuthorId(dto.authorId, tokenUserId);

    const publishedAt = this.resolvePublishedAt(
      statusCode,
      dto.publishedAt,
      null,
    );

    // Sube la portada (si vino) al bucket público y guarda su URL directa.
    const coverImageUrl = coverFile
      ? await this.uploadCover(dto.slug, coverFile)
      : null;

    const created = await this.repository.create({
      slug: dto.slug,
      title: dto.title,
      content: dto.content,
      excerpt: dto.excerpt ?? null,
      coverImageUrl,
      categoryId,
      authorId,
      readingMinutes:
        dto.readingMinutes ?? this.estimateReadingMinutes(dto.content),
      tags: dto.tags ?? [],
      statusId,
      publishedAt,
      metaTitle: dto.metaTitle ?? null,
      metaDescription: dto.metaDescription ?? null,
      sourceUrl: dto.sourceUrl ?? null,
    });

    return this.toDetail(created);
  }

  /** Actualiza un artículo. Re-valida slug si cambia; maneja transición de estado. */
  async update(
    id: string,
    dto: UpdateBlogPostDto,
    tokenUserId: string,
    coverFile?: Express.Multer.File,
  ) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Artículo con id=${id} no encontrado`);
    }

    const data: Prisma.BlogPostUncheckedUpdateInput = {};

    // Nueva portada: se sube al bucket público bajo el slug del artículo
    // (estable, no editable) y se reemplaza la URL.
    if (coverFile) {
      data.coverImageUrl = await this.uploadCover(current.slug, coverFile);
    }

    if (dto.slug !== undefined && dto.slug !== current.slug) {
      const duplicate = await this.repository.findBySlug(dto.slug);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(
          `Ya existe un artículo con slug="${dto.slug}"`,
        );
      }
      data.slug = dto.slug;
    }

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.excerpt !== undefined) data.excerpt = dto.excerpt;
    // readingMinutes: valor explícito manda; si no viene pero cambia el content,
    // se recalcula automáticamente desde el nuevo texto.
    if (dto.readingMinutes !== undefined) {
      data.readingMinutes = dto.readingMinutes;
    } else if (dto.content !== undefined) {
      data.readingMinutes = this.estimateReadingMinutes(dto.content);
    }
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.metaTitle !== undefined) data.metaTitle = dto.metaTitle;
    if (dto.metaDescription !== undefined)
      data.metaDescription = dto.metaDescription;
    if (dto.sourceUrl !== undefined) data.sourceUrl = dto.sourceUrl;

    if (dto.category !== undefined) {
      data.categoryId = await this.getCategoryId(dto.category);
    }

    if (dto.authorId !== undefined) {
      data.authorId = await this.resolveAuthorId(dto.authorId, tokenUserId);
    }

    // Estado: si cambia, resolver id; al pasar a published sin publishedAt
    // explícito y sin fecha previa, sellar con la fecha actual.
    const newStatusCode = dto.status ?? current.status.code;
    if (dto.status !== undefined) {
      data.statusId = await this.getStatusId(dto.status);
    }
    if (dto.status !== undefined || dto.publishedAt !== undefined) {
      data.publishedAt = this.resolvePublishedAt(
        newStatusCode,
        dto.publishedAt,
        current.publishedAt,
      );
    }

    const updated = await this.repository.update(id, data);
    return this.toDetail(updated);
  }

  /** Borrado suave: pasa el estado a 'archived' (no elimina la fila). */
  async archive(id: string) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Artículo con id=${id} no encontrado`);
    }
    const archivedId = await this.getStatusId('archived');
    const updated = await this.repository.update(id, { statusId: archivedId });
    return this.toDetail(updated);
  }

  // ── Helpers de resolución ──────────────────────────────────────────────

  /**
   * Sube la portada al bucket PÚBLICO blog-covers bajo {slug}/cover.{ext}
   * (upsert: re-subir reemplaza) y devuelve la URL pública directa.
   */
  private async uploadCover(
    slug: string,
    file: Express.Multer.File,
  ): Promise<string> {
    const ext = file.originalname.split('.').pop() ?? 'webp';
    const storagePath = `${slug}/cover.${ext}`;
    await this.supabaseService.uploadFile(
      BLOG_COVER_BUCKET,
      storagePath,
      file.buffer,
      file.mimetype,
    );
    return this.supabaseService.getPublicUrl(BLOG_COVER_BUCKET, storagePath);
  }

  /**
   * Estima los minutos de lectura a partir del content HTML: quita las etiquetas,
   * cuenta palabras y divide por ~200 ppm (velocidad de lectura promedio).
   * Mínimo 1 minuto si hay algo de texto. Solo se usa como fallback cuando el
   * admin no envía readingMinutes explícito.
   */
  private estimateReadingMinutes(content: string): number {
    const text = content
      .replace(/<[^>]*>/g, ' ') // quitar etiquetas HTML
      .replace(/&[a-z]+;/gi, ' ') // entidades (&nbsp; &amp; ...)
      .trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words === 0) return 1;
    return Math.max(1, Math.ceil(words / 200));
  }

  private async getCategoryId(code: string): Promise<number> {
    const param = await this.repository.findParameterByTypeAndCode(
      BLOG_CATEGORY_TYPE,
      code,
    );
    if (!param) {
      throw new BadRequestException(`Categoría inválida: "${code}"`);
    }
    return param.id;
  }

  private async getStatusId(code: string): Promise<number> {
    const param = await this.repository.findParameterByTypeAndCode(
      BLOG_STATUS_TYPE,
      code,
    );
    if (!param) {
      throw new BadRequestException(`Estado inválido: "${code}"`);
    }
    return param.id;
  }

  private async resolveAuthorId(
    explicitAuthorId: string | undefined,
    tokenUserId: string,
  ): Promise<string> {
    if (explicitAuthorId) {
      const admin =
        await this.repository.findPlatformAdminById(explicitAuthorId);
      if (!admin) {
        throw new BadRequestException(
          `Autor (PlatformAdmin) inválido: ${explicitAuthorId}`,
        );
      }
      return admin.id;
    }
    const admin = await this.repository.findPlatformAdminByUserId(tokenUserId);
    if (!admin) {
      throw new BadRequestException(
        'El usuario del token no es un administrador de la plataforma',
      );
    }
    return admin.id;
  }

  private resolvePublishedAt(
    statusCode: string,
    dtoPublishedAt: string | undefined,
    currentPublishedAt: Date | null,
  ): Date | null {
    if (dtoPublishedAt !== undefined) {
      return new Date(dtoPublishedAt);
    }
    if (statusCode === 'published' && !currentPublishedAt) {
      return new Date();
    }
    return currentPublishedAt;
  }

  private async applyCategoryFilter(
    where: Prisma.BlogPostWhereInput,
    category: string | undefined,
  ) {
    if (!category) return;
    const param = await this.repository.findParameterByTypeAndCode(
      BLOG_CATEGORY_TYPE,
      category,
    );
    where.categoryId = param?.id ?? -1;
  }

  private applyTagFilter(
    where: Prisma.BlogPostWhereInput,
    tag: string | undefined,
  ) {
    if (tag) where.tags = { has: tag };
  }

  private applySearchFilter(
    where: Prisma.BlogPostWhereInput,
    search: string | undefined,
  ) {
    if (!search) return;
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { excerpt: { contains: search, mode: 'insensitive' } },
    ];
  }

  // ── Serialización al contrato del front ────────────────────────────────

  private mapCategory(post: BlogPostWithRelations) {
    return {
      id: post.category.id,
      name: post.category.label,
      slug: post.category.code,
    };
  }

  private mapAuthor(post: BlogPostWithRelations) {
    return {
      name: post.author.name,
      role: post.author.role?.label ?? null,
      avatarUrl: post.author.avatarUrl ?? null,
    };
  }

  /** Item del listado (sin content). */
  private toListItem(post: BlogPostWithRelations) {
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      coverImageUrl: post.coverImageUrl,
      category: this.mapCategory(post),
      author: this.mapAuthor(post),
      readingMinutes: post.readingMinutes,
      publishedAt: post.publishedAt,
      tags: post.tags,
    };
  }

  /** Detalle completo (con content, status y SEO). */
  private toDetail(post: BlogPostWithRelations) {
    return {
      ...this.toListItem(post),
      content: post.content,
      status: post.status.code,
      updatedAt: post.updatedAt,
      metaTitle: post.metaTitle,
      metaDescription: post.metaDescription,
      sourceUrl: post.sourceUrl,
    };
  }
}
