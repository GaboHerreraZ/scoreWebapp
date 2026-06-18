import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ConsultationPricesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    discountType: true,
    createdByAdmin: true,
    updatedByAdmin: true,
  } as const;

  async create(data: Prisma.ConsultationPriceUncheckedCreateInput) {
    // Si el nuevo precio entra activo, debe ser el ÚNICO activo: desactivamos
    // el resto en la misma transacción para garantizar la exclusividad.
    if (data.isActive !== false) {
      return this.prisma.$transaction(async (tx) => {
        await tx.consultationPrice.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
        return tx.consultationPrice.create({
          data: { ...data, isActive: true },
          include: this.defaultInclude,
        });
      });
    }

    return this.prisma.consultationPrice.create({
      data,
      include: this.defaultInclude,
    });
  }

  async findMany(params: {
    skip: number;
    take: number;
    where: Prisma.ConsultationPriceWhereInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.consultationPrice.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        // El activo primero; dentro de cada grupo, el más reciente arriba.
        orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }],
        include: this.defaultInclude,
      }),
      this.prisma.consultationPrice.count({ where: params.where }),
    ]);
    return { data, total };
  }

  async findById(id: string) {
    return this.prisma.consultationPrice.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  /**
   * Precio de consulta vigente: el registro activo más reciente.
   * Su unitPrice es el que se usa para calcular el precio de un plan.
   */
  async findActive() {
    return this.prisma.consultationPrice.findFirst({
      where: { isActive: true },
      orderBy: { validFrom: 'desc' },
    });
  }

  async update(id: string, data: Prisma.ConsultationPriceUncheckedUpdateInput) {
    // Si este registro se activa, desactivamos cualquier otro activo para
    // mantener un único precio vigente.
    if (data.isActive === true) {
      return this.prisma.$transaction(async (tx) => {
        await tx.consultationPrice.updateMany({
          where: { isActive: true, id: { not: id } },
          data: { isActive: false },
        });
        return tx.consultationPrice.update({
          where: { id },
          data,
          include: this.defaultInclude,
        });
      });
    }

    return this.prisma.consultationPrice.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async delete(id: string) {
    return this.prisma.consultationPrice.delete({ where: { id } });
  }

  /** Nº de bolsas compradas con este precio (impide borrado si > 0). */
  async countAnalysisPacks(id: string): Promise<number> {
    return this.prisma.analysisPack.count({
      where: { consultationPriceId: id },
    });
  }

  /** Resuelve el PlatformAdmin (PK) a partir del userId de Supabase. */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }
}
