import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Columnas del listado: todo menos el JSONB pesado y el texto crudo. */
const LIST_SELECT = {
  id: true,
  fileName: true,
  fileSizeBytes: true,
  incomeStatementId: true,
  fiscalYear: true,
  model: true,
  totalTokens: true,
  estimatedCostUsd: true,
  durationMs: true,
  periodsCount: true,
  flagsCount: true,
  performedBy: true,
  createdAt: true,
} as const;

@Injectable()
export class PdfExtractionTestRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.PdfExtractionTestUncheckedCreateInput) {
    return this.prisma.pdfExtractionTest.create({ data });
  }

  /** Listado paginado (más reciente primero), opcionalmente por nombre. */
  async findAll(params: { skip: number; take: number; search?: string }) {
    const where: Prisma.PdfExtractionTestWhereInput = params.search
      ? { fileName: { contains: params.search, mode: 'insensitive' } }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.pdfExtractionTest.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        select: LIST_SELECT,
      }),
      this.prisma.pdfExtractionTest.count({ where }),
    ]);

    return { data, total };
  }

  /** Corrida completa: incluye el response JSONB y el texto crudo. */
  findById(id: string) {
    return this.prisma.pdfExtractionTest.findUnique({ where: { id } });
  }

  delete(id: string) {
    return this.prisma.pdfExtractionTest.delete({ where: { id } });
  }

  /**
   * Nombre/correo de los admins del portal que corrieron las pruebas. Se
   * resuelve aparte porque performed_by guarda el userId de Supabase sin FK
   * (misma convención que credit_study_resets.reset_by).
   */
  async platformAdminsByUserId(userIds: string[]) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) {
      return new Map<
        string,
        { userId: string; name: string | null; email: string }
      >();
    }
    const admins = await this.prisma.platformAdmin.findMany({
      where: { userId: { in: unique } },
      select: { userId: true, name: true, email: true },
    });
    return new Map(admins.map((a) => [a.userId, a]));
  }
}
