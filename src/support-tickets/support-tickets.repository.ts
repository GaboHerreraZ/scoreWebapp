import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class SupportTicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Para listar/leer: catálogos (code/label), empresa, admin asignado y autor.
  private readonly defaultInclude = {
    area: { select: { code: true, label: true } },
    type: { select: { code: true, label: true } },
    priority: { select: { code: true, label: true } },
    status: { select: { code: true, label: true } },
    company: { select: { id: true, name: true, nit: true } },
    assignedToAdmin: { select: { id: true, email: true } },
    createdByUser: { select: { id: true, name: true, lastName: true, email: true } },
  } as const;

  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }

  /**
   * Crea el ticket con un reference SUP-AAAA-###### generado atómicamente. Todo
   * en una transacción: incrementa el contador del año (upsert + RETURNING) y
   * crea el ticket. El lock de fila del contador serializa los correlativos, así
   * que no hay duplicados aunque entren varios tickets a la vez.
   */
  async createWithReference(
    data: Omit<Prisma.SupportTicketUncheckedCreateInput, 'reference'>,
    year: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.supportTicketCounter.upsert({
        where: { year },
        create: { year, lastSeq: 1 },
        update: { lastSeq: { increment: 1 } },
      });
      const seq = String(counter.lastSeq).padStart(6, '0');
      const reference = `SUP-${year}-${seq}`;

      return tx.supportTicket.create({
        data: { ...data, reference },
        include: this.defaultInclude,
      });
    });
  }

  async findById(id: string) {
    return this.prisma.supportTicket.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async findMany(params: {
    skip: number;
    take: number;
    where: Prisma.SupportTicketWhereInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: this.defaultInclude,
      }),
      this.prisma.supportTicket.count({ where: params.where }),
    ]);
    return { data, total };
  }

  async update(id: string, data: Prisma.SupportTicketUncheckedUpdateInput) {
    return this.prisma.supportTicket.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }
}
