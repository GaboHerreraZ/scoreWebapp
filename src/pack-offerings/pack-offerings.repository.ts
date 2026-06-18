import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PackOfferingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    discountType: true,
    createdByAdmin: { select: { email: true } },
  } as const;

  async create(data: Prisma.PackOfferingUncheckedCreateInput) {
    return this.prisma.packOffering.create({
      data,
      include: this.defaultInclude,
    });
  }

  async findMany(params: {
    skip: number;
    take: number;
    where: Prisma.PackOfferingWhereInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.packOffering.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: [{ sortOrder: 'asc' }, { quantity: 'asc' }],
        include: this.defaultInclude,
      }),
      this.prisma.packOffering.count({ where: params.where }),
    ]);
    return { data, total };
  }

  /**
   * Catálogo ofrecible al cliente: ofertas activas y vigentes, ordenadas para
   * mostrar. Sin paginación (son pocas) — el front pinta todas las tarjetas.
   */
  async findOfferable() {
    return this.prisma.packOffering.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { quantity: 'asc' }],
      include: { discountType: true },
    });
  }

  async findById(id: string) {
    return this.prisma.packOffering.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async update(id: string, data: Prisma.PackOfferingUncheckedUpdateInput) {
    return this.prisma.packOffering.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async delete(id: string) {
    return this.prisma.packOffering.delete({ where: { id } });
  }

  /** Nº de bolsas compradas a partir de esta oferta (impide borrado si > 0). */
  async countAnalysisPacks(id: string): Promise<number> {
    return this.prisma.analysisPack.count({
      where: { packOfferingId: id },
    });
  }

  /** Resuelve el PlatformAdmin (PK) a partir del userId de Supabase. */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }

  /** Code del Parameter de tipo de descuento (para interpretar el descuento). */
  async findDiscountTypeCodeById(id: number): Promise<string | null> {
    const param = await this.prisma.parameter.findUnique({
      where: { id },
      select: { code: true },
    });
    return param?.code ?? null;
  }
}
