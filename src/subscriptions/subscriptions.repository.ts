import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    createdByAdmin: true,
    companySubscriptions: { include: { company: true, status: true } },
  } as const;

  async create(data: Prisma.SubscriptionUncheckedCreateInput) {
    return this.prisma.subscription.create({
      data,
      include: this.defaultInclude,
    });
  }

  // Solo planes del catálogo vigente: isActive y isCurrent. Los planes legados
  // (isCurrent=false) siguen cobrando a quien ya los tiene pero no se ofrecen.
  private readonly currentActiveWhere: Prisma.SubscriptionWhereInput = {
    isActive: true,
    isCurrent: true,
  };

  findMany<T extends Prisma.SubscriptionFindManyArgs>(
    args: Prisma.SelectSubset<T, Prisma.SubscriptionFindManyArgs>,
  ) {
    return this.prisma.subscription.findMany(args);
  }

  /** Planes del catálogo vigente, ordenados y con el admin creador (para listar). */
  findAllActive() {
    return this.findMany({
      where: this.currentActiveWhere,
      orderBy: { maxStudiesPerMonth: 'asc' },
      include: { createdByAdmin: true },
    });
  }

  /** Planes del catálogo vigente, solo escalares (para el resync). */
  findCurrentActive() {
    return this.findMany({ where: this.currentActiveWhere });
  }

  /**
   * TODOS los planes sin filtro (vigentes, legados y desactivados), con el admin
   * creador. Para la vista de administración del portal.
   */
  findAllIncludingInactive() {
    return this.findMany({
      orderBy: [{ isCurrent: 'desc' }, { maxStudiesPerMonth: 'asc' }],
      include: { createdByAdmin: true },
    });
  }

  async findByName(name: string) {
    return this.prisma.subscription.findFirst({
      where: { name, isActive: true },
    });
  }

  async findById(id: string) {
    return this.prisma.subscription.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async update(id: string, data: Prisma.SubscriptionUncheckedUpdateInput) {
    return this.prisma.subscription.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async delete(id: string) {
    return this.prisma.subscription.delete({ where: { id } });
  }

  /**
   * ¿Alguna empresa referencia este plan, vigente o históricamente? Cuenta TODA
   * CompanySubscription (no solo las isCurrent): una referencia histórica
   * (isCurrent=false) es la auditoría de qué plan tuvo la empresa, y borrar el
   * Subscription físicamente la dejaría apuntando a la nada.
   */
  async hasCompanies(id: string): Promise<boolean> {
    const count = await this.prisma.companySubscription.count({
      where: { subscriptionId: id },
    });
    return count > 0;
  }

  /** Resuelve el PlatformAdmin (PK) a partir del userId de Supabase. */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }

  /**
   * Reemplaza el catálogo vigente en una transacción: marca los planes actuales
   * como legados (isCurrent=false, sin tocar isActive ni ePayco) y crea los nuevos
   * (ya con su epaycoPlanId resuelto fuera). Garantiza que no queden dos catálogos
   * vigentes a la vez aunque algo falle entre medias.
   */
  async replaceCurrentCatalog(params: {
    oldPlanIds: string[];
    newPlans: Prisma.SubscriptionUncheckedCreateInput[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      if (params.oldPlanIds.length > 0) {
        await tx.subscription.updateMany({
          where: { id: { in: params.oldPlanIds } },
          data: { isCurrent: false },
        });
      }
      const created = [];
      for (const data of params.newPlans) {
        created.push(
          await tx.subscription.create({ data: { ...data, isCurrent: true } }),
        );
      }
      return created;
    });
  }
}
