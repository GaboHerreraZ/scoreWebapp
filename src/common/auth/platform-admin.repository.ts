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

  // La ciudad se devuelve resuelta con su departamento: el front pinta ambos y
  // el departamento no existe como columna (sale de dane_cities.region).
  private readonly citySelect = {
    select: {
      code: true,
      name: true,
      region: { select: { code: true, name: true } },
    },
  } as const;

  private readonly defaultSelect = {
    id: true,
    userId: true,
    name: true,
    lastName: true,
    email: true,
    phone: true,
    identificationNumber: true,
    address: true,
    cityCode: true,
    avatarUrl: true,
    isActive: true,
    role: { select: { id: true, code: true, label: true } },
    identificationType: { select: { id: true, code: true, label: true } },
    daneCity: this.citySelect,
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

  /**
   * PlatformAdmin por su userId de Supabase, con el rol resuelto. Incluye el
   * avatar: el portal pinta la foto del usuario logueado en su perfil.
   */
  async findByUserIdWithRole(userId: string) {
    return this.prisma.platformAdmin.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        lastName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        role: { select: { code: true, label: true } },
        // Ficha de vendedor si la tiene: el portal la usa para mostrarle sus
        // códigos y sus comisiones. Un admin también puede vender.
        salesRep: { select: { id: true, code: true, isActive: true } },
      },
    });
  }

  /**
   * Emails para notificaciones internas (soporte/ventas): los admins activos del
   * portal MÁS el buzón central de soporte (SUPPORT_EMAIL, default
   * soporte@creditia.co), que siempre debe recibir copia. Sin duplicados.
   * Con roleCode se limita a los usuarios activos con ese rol del portal
   * (p.ej. 'admin' para los correos de ventas cobradas y reversas).
   */
  async findActiveAdminEmails(roleCode?: string): Promise<string[]> {
    const admins = await this.prisma.platformAdmin.findMany({
      where: {
        isActive: true,
        ...(roleCode
          ? { role: { type: 'platform_admin_role', code: roleCode } }
          : {}),
      },
      select: { email: true },
    });
    const emails = admins.map((a) => a.email).filter((e): e is string => !!e);

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
        lastName: true,
        email: true,
        phone: true,
        identificationNumber: true,
        address: true,
        cityCode: true,
        avatarUrl: true,
        isActive: true,
        role: { select: { id: true, code: true, label: true } },
        identificationType: { select: { id: true, code: true, label: true } },
        daneCity: this.citySelect,
      },
    });
  }
}
