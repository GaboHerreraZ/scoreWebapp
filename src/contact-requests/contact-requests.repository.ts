import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ContactRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Para listar/leer: subject/status (label/code) + admins asignado/gestor.
  private readonly defaultInclude = {
    subject: { select: { code: true, label: true } },
    status: { select: { code: true, label: true } },
    assignedToAdmin: { select: { id: true, email: true } },
    handledByAdmin: { select: { id: true, email: true } },
  } as const;

  /** Parameter por type+code (subject/status del lead). */
  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  /** PlatformAdmin por su userId de Supabase (para handledBy desde el token). */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }

  async create(data: Prisma.ContactRequestUncheckedCreateInput) {
    return this.prisma.contactRequest.create({
      data,
      include: this.defaultInclude,
    });
  }

  async findById(id: string) {
    return this.prisma.contactRequest.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async findMany(params: {
    skip: number;
    take: number;
    where: Prisma.ContactRequestWhereInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.contactRequest.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: this.defaultInclude,
      }),
      this.prisma.contactRequest.count({ where: params.where }),
    ]);
    return { data, total };
  }

  async update(id: string, data: Prisma.ContactRequestUncheckedUpdateInput) {
    return this.prisma.contactRequest.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }
}
