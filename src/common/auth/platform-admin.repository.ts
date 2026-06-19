import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PlatformAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** True si el usuario de Supabase es un super-admin activo del portal. */
  async isPlatformAdmin(userId: string): Promise<boolean> {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { userId },
    });
    return !!admin && admin.isActive;
  }

  /** Emails de los admins activos del portal (para notificaciones internas). */
  async findActiveAdminEmails(): Promise<string[]> {
    const admins = await this.prisma.platformAdmin.findMany({
      where: { isActive: true },
      select: { email: true },
    });
    return admins.map((a) => a.email).filter((e): e is string => !!e);
  }
}
