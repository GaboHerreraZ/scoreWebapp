import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class FeatureFlagsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.featureFlag.findMany({ orderBy: { code: 'asc' } });
  }

  findAllWithAdmin() {
    return this.prisma.featureFlag.findMany({
      orderBy: { code: 'asc' },
      include: {
        updatedByAdmin: {
          select: { id: true, name: true, lastName: true, email: true },
        },
      },
    });
  }

  /** Upsert: el toggle funciona aunque el seed del flag no exista aún. */
  setEnabled(
    code: string,
    enabled: boolean,
    updatedBy: string | null,
    description?: string,
  ) {
    return this.prisma.featureFlag.upsert({
      where: { code },
      update: { enabled, updatedBy },
      create: { code, enabled, updatedBy, description },
    });
  }
}
