import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class BlogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Include para serializar category (id/code/label), status (code) y author
  // (nombre + rol + avatar). El code de category/status alimenta el shape del
  // contrato público (slug de categoría = code; status = code).
  private readonly defaultInclude = {
    category: { select: { id: true, code: true, label: true } },
    status: { select: { code: true } },
    author: {
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        role: { select: { label: true } },
      },
    },
  } as const;

  /** Parameter por type+code (category/status del artículo). */
  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  /** PlatformAdmin por su userId de Supabase (autor por defecto desde el token). */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }

  /** Existencia de un PlatformAdmin por id (validar authorId explícito). */
  async findPlatformAdminById(id: string) {
    return this.prisma.platformAdmin.findUnique({ where: { id } });
  }

  /** Artículo por slug (para chequeo de unicidad en create/update). */
  async findBySlug(slug: string) {
    return this.prisma.blogPost.findUnique({ where: { slug } });
  }

  async findById(id: string) {
    return this.prisma.blogPost.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  /** Detalle por slug con include (usado por listado admin y público). */
  async findBySlugWithRelations(slug: string) {
    return this.prisma.blogPost.findUnique({
      where: { slug },
      include: this.defaultInclude,
    });
  }

  async findMany(params: {
    skip: number;
    take: number;
    where: Prisma.BlogPostWhereInput;
    orderBy: Prisma.BlogPostOrderByWithRelationInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: this.defaultInclude,
      }),
      this.prisma.blogPost.count({ where: params.where }),
    ]);
    return { data, total };
  }

  async create(data: Prisma.BlogPostUncheckedCreateInput) {
    return this.prisma.blogPost.create({
      data,
      include: this.defaultInclude,
    });
  }

  async update(id: string, data: Prisma.BlogPostUncheckedUpdateInput) {
    return this.prisma.blogPost.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }
}
