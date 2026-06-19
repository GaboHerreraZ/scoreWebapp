import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PaymentAlertsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Para listar/leer: trae los Parameter (label/code) y datos mínimos de la
  // empresa y la bolsa para que el panel pinte sin más queries.
  private readonly defaultInclude = {
    type: { select: { code: true, label: true } },
    severity: { select: { code: true, label: true } },
    status: { select: { code: true, label: true } },
    company: { select: { id: true, name: true, nit: true } },
    resolvedByUser: { select: { id: true, name: true, lastName: true } },
  } as const;

  /** Parameter por type+code (tipos, severidades y estados de alerta). */
  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  async create(data: Prisma.PaymentAlertUncheckedCreateInput) {
    return this.prisma.paymentAlert.create({ data });
  }

  async findById(id: string) {
    return this.prisma.paymentAlert.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  /** Listado paginado (panel admin): todas las empresas, filtrable por estado. */
  async findMany(params: {
    skip: number;
    take: number;
    where: Prisma.PaymentAlertWhereInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.paymentAlert.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: this.defaultInclude,
      }),
      this.prisma.paymentAlert.count({ where: params.where }),
    ]);
    return { data, total };
  }

  async update(id: string, data: Prisma.PaymentAlertUncheckedUpdateInput) {
    return this.prisma.paymentAlert.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }
}
