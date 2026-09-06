import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ConsultationPricesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    createdByAdmin: true,
    updatedByAdmin: true,
    productType: true,
  } as const;

  async create(data: Prisma.ConsultationPriceUncheckedCreateInput) {
    // Si el nuevo precio entra activo, debe ser el ÚNICO activo DE SU PRODUCTO:
    // desactivamos el resto del mismo producto en la misma transacción.
    if (data.isActive !== false) {
      return this.prisma.$transaction(async (tx) => {
        await tx.consultationPrice.updateMany({
          where: {
            isActive: true,
            productTypeId: data.productTypeId,
          },
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
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
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
   * Precio vigente de UN producto: su registro activo más reciente. El unitPrice
   * es el que se usa para cotizar los packs de ese producto.
   */
  async findActive(productTypeId: number) {
    return this.prisma.consultationPrice.findFirst({
      where: { isActive: true, productTypeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: Prisma.ConsultationPriceUncheckedUpdateInput) {
    // Si este registro se activa, desactivamos cualquier otro activo DE SU
    // PRODUCTO para mantener un único precio vigente por producto.
    if (data.isActive === true) {
      return this.prisma.$transaction(async (tx) => {
        const current = await tx.consultationPrice.findUniqueOrThrow({
          where: { id },
          select: { productTypeId: true },
        });
        await tx.consultationPrice.updateMany({
          where: {
            isActive: true,
            productTypeId: current.productTypeId,
            id: { not: id },
          },
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

  /** Nº de precios activos de un producto (creditStudy exige al menos uno). */
  async countActive(productTypeId: number): Promise<number> {
    return this.prisma.consultationPrice.count({
      where: { isActive: true, productTypeId },
    });
  }

  /** Nº de bolsas compradas con este precio (impide borrado si > 0). */
  async countAnalysisPacks(id: string): Promise<number> {
    return this.prisma.analysisPack.count({
      where: { consultationPriceId: id },
    });
  }

  /** Parameter 'pack_product_type' por code (creditStudy | bureauCheck). */
  async findProductType(code: string) {
    return this.prisma.parameter.findUnique({
      where: { type_code: { type: 'pack_product_type', code } },
    });
  }

  /** Resuelve el PlatformAdmin (PK) a partir del userId de Supabase. */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }
}
