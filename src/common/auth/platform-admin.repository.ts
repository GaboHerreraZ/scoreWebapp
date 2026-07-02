import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class PlatformAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private readonly defaultSelect = {
    id: true,
    userId: true,
    name: true,
    email: true,
    phone: true,
    avatarUrl: true,
    isActive: true,
    role: { select: { id: true, code: true, label: true } },
  } as const;

  /** Crea un PlatformAdmin (tras crear el usuario en Supabase). */
  async create(data: Prisma.PlatformAdminUncheckedCreateInput) {
    return this.prisma.platformAdmin.create({
      data,
      select: this.defaultSelect,
    });
  }

  async findById(id: string) {
    return this.prisma.platformAdmin.findUnique({
      where: { id },
      select: this.defaultSelect,
    });
  }

  /** Activa/desactiva un PlatformAdmin (borrado lógico). */
  async setActive(id: string, isActive: boolean) {
    return this.prisma.platformAdmin.update({
      where: { id },
      data: { isActive },
      select: this.defaultSelect,
    });
  }

  /** Edita datos del perfil de un PlatformAdmin (name/phone/roleId). */
  async update(id: string, data: Prisma.PlatformAdminUncheckedUpdateInput) {
    return this.prisma.platformAdmin.update({
      where: { id },
      data,
      select: this.defaultSelect,
    });
  }

  /** Parameter por type+code (validar el rol platform_admin_role). */
  async findParameterById(id: number) {
    return this.prisma.parameter.findUnique({ where: { id } });
  }

  /** ¿Existe ya un PlatformAdmin con ese email? (evitar duplicados). */
  async findByEmail(email: string) {
    return this.prisma.platformAdmin.findFirst({ where: { email } });
  }

  /** True si el usuario de Supabase es un super-admin activo del portal. */
  async isPlatformAdmin(userId: string): Promise<boolean> {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { userId },
    });
    return !!admin && admin.isActive;
  }

  /** PlatformAdmin por su userId de Supabase, con el rol resuelto. */
  async findByUserIdWithRole(userId: string) {
    return this.prisma.platformAdmin.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        role: { select: { code: true, label: true } },
      },
    });
  }

  /**
   * Emails para notificaciones internas (soporte/ventas): los admins activos del
   * portal MÁS el buzón central de soporte (SUPPORT_EMAIL, default
   * soporte@creditia.co), que siempre debe recibir copia. Sin duplicados.
   */
  async findActiveAdminEmails(): Promise<string[]> {
    const admins = await this.prisma.platformAdmin.findMany({
      where: { isActive: true },
      select: { email: true },
    });
    const emails = admins
      .map((a) => a.email)
      .filter((e): e is string => !!e);

    const supportEmail =
      this.configService.get<string>('SUPPORT_EMAIL') || 'soporte@creditia.co';

    // Set para deduplicar (case-insensitive) si un admin ya usa ese correo.
    const seen = new Set<string>();
    const result: string[] = [];
    for (const e of [...emails, supportEmail]) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(e);
      }
    }
    return result;
  }

  /**
   * Admins del portal con datos para la gestión y los selectores. Por defecto
   * trae TODOS (activos e inactivos, con su isActive para que el front muestre
   * el estado); con onlyActive=true filtra solo los activos (p.ej. para el
   * selector de asignación de leads). Ordenados por nombre.
   */
  async findAdmins(onlyActive = false) {
    return this.prisma.platformAdmin.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        role: { select: { code: true, label: true } },
      },
    });
  }
}
