import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { MailService } from '../mail/mail.service.js';
import { OnboardClientDto } from './dto/onboard-client.dto.js';
import { ChangeTierDto } from './dto/change-tier.dto.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly mailService: MailService,
  ) {}

  /** Resuelve un parámetro por type+code o lanza error claro. */
  private async getParam(type: string, code: string) {
    const param = await this.parametersRepository.findByTypeAndCode(type, code);
    if (!param) {
      throw new BadRequestException(
        `Falta el parámetro requerido: type=${type}, code=${code}`,
      );
    }
    return param;
  }

  /**
   * Alta completa de un cliente en una sola operación atómica:
   * crea Company + CompanySubscription (plan elegido + nivel) + Invitation (owner).
   * Todo o nada. El cliente recibe el link de invitación y entra con todo listo.
   * El plan (subscriptionId) lo elige el admin desde el portal.
   */
  async onboardClient(dto: OnboardClientDto, adminUserId: string) {
    const subscriptionId = dto.subscription.subscriptionId;

    // Validaciones previas a la transacción (fallar rápido).
    const existingNit = await this.prisma.company.findUnique({
      where: { nit: dto.company.nit },
    });
    if (existingNit) {
      throw new ConflictException(
        `Ya existe una empresa con el NIT ${dto.company.nit}`,
      );
    }

    const plan = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!plan) {
      throw new BadRequestException(
        `El plan indicado (subscriptionId=${subscriptionId}) no existe.`,
      );
    }

    const existingProfile = await this.prisma.profile.findFirst({
      where: { email: dto.owner.email },
    });

    const [activeSubStatus, pendingInvStatus, ownerRole] = await Promise.all([
      this.getParam('subscription_status', 'active'),
      this.getParam('invitation_status', 'pending'),
      this.getParam('user_company_role', 'owner'),
    ]);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const newContractId = crypto.randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Empresa
      const company = await tx.company.create({
        data: {
          name: dto.company.name,
          nit: dto.company.nit,
          sectorId: dto.company.sectorId,
          state: dto.company.state,
          city: dto.company.city,
          address: dto.company.address,
          billingName: dto.company.billingName,
          billingLastName: dto.company.billingLastName,
          billingDocTypeId: dto.company.billingDocTypeId,
          billingDocNumber: dto.company.billingDocNumber,
          billingEmail: dto.company.billingEmail,
          billingPhone: dto.company.billingPhone,
        },
      });

      // 2. Suscripción (plan elegido + nivel configurado)
      const subscription = await tx.companySubscription.create({
        data: {
          companyId: company.id,
          subscriptionId,
          statusId: activeSubStatus.id,
          startDate: new Date(dto.subscription.startDate),
          endDate: new Date(dto.subscription.endDate),
          isCurrent: true,
          autoRenew: false,
          pricePaid: dto.subscription.pricePaid,
          maxStudiesPerMonthOverride: dto.subscription.studiesPerMonth,
          contractId: newContractId,
        },
      });

      // 3. Invitación del dueño (rol owner)
      const invitation = await tx.invitation.create({
        data: {
          email: dto.owner.email,
          companyId: company.id,
          roleId: ownerRole.id,
          statusId: pendingInvStatus.id,
          token,
          expiresAt,
          invitedBy: adminUserId,
        },
      });

      // Si ya existe un perfil con ese email, crear UserCompany inactivo
      if (existingProfile) {
        await tx.userCompany.create({
          data: {
            userId: existingProfile.id,
            companyId: company.id,
            roleId: ownerRole.id,
            invitedBy: adminUserId,
            isActive: false,
          },
        });
      }

      return { company, subscription, invitation };
    });

    // Envío de email fuera de la transacción (best effort).
    this.mailService
      .sendInvitationEmail({
        to: dto.owner.email,
        invitationId: result.invitation.id,
        token,
        companyName: result.company.name,
        invitedByName: 'El equipo de Creditia',
      })
      .catch(() => {});

    return {
      company: {
        id: result.company.id,
        name: result.company.name,
        nit: result.company.nit,
      },
      subscription: {
        id: result.subscription.id,
        studiesPerMonth: result.subscription.maxStudiesPerMonthOverride,
        startDate: result.subscription.startDate,
        endDate: result.subscription.endDate,
        contractId: result.subscription.contractId,
      },
      invitation: {
        id: result.invitation.id,
        email: result.invitation.email,
        statusCode: 'pending',
        expiresAt: result.invitation.expiresAt,
      },
    };
  }

  /**
   * Cambia el nivel mensual (estudios/mes). Inmediato: cierra el registro vigente
   * como "superseded" y abre uno nuevo con el nuevo nivel y el mismo contractId.
   * El consumo del ciclo se reinicia (el nuevo registro empieza a contar desde su startDate).
   */
  async changeTier(companyId: string, dto: ChangeTierDto) {
    const current = await this.prisma.companySubscription.findFirst({
      where: { companyId, isCurrent: true },
    });
    if (!current) {
      throw new NotFoundException(
        'La empresa no tiene una suscripción vigente.',
      );
    }

    const [activeStatus, supersededStatus] = await Promise.all([
      this.getParam('subscription_status', 'active'),
      this.getParam('subscription_status', 'superseded'),
    ]);

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Cerrar el registro vigente
      await tx.companySubscription.update({
        where: { id: current.id },
        data: {
          isCurrent: false,
          statusId: supersededStatus.id,
          endDate: now,
        },
      });

      // Abrir el nuevo tramo (mismo contractId, fin = fin del contrato original)
      const next = await tx.companySubscription.create({
        data: {
          companyId,
          subscriptionId: current.subscriptionId,
          statusId: activeStatus.id,
          startDate: now,
          endDate: current.endDate,
          isCurrent: true,
          autoRenew: current.autoRenew,
          maxStudiesPerMonthOverride: dto.studiesPerMonth,
          contractId: current.contractId,
        },
      });

      return next;
    });

    return {
      id: result.id,
      studiesPerMonth: result.maxStudiesPerMonthOverride,
      startDate: result.startDate,
      endDate: result.endDate,
      contractId: result.contractId,
    };
  }

  /** Listado cross-tenant de clientes con su nivel vigente y vigencia. */
  async listClients(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { nit: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          companySubscriptions: {
            where: { isCurrent: true },
            include: { subscription: { select: { name: true } }, status: true },
          },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    const data = companies.map((c) => {
      const sub = c.companySubscriptions[0];
      return {
        id: c.id,
        name: c.name,
        nit: c.nit,
        isActive: c.isActive,
        subscription: sub
          ? {
              id: sub.id,
              plan: sub.subscription?.name,
              studiesPerMonth: sub.maxStudiesPerMonthOverride,
              startDate: sub.startDate,
              endDate: sub.endDate,
              status: sub.status?.code,
            }
          : null,
      };
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Detalle de un cliente: empresa, suscripción vigente, tramos del contrato, usuarios. */
  async getClientDetail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        companySubscriptions: {
          orderBy: { startDate: 'asc' },
          include: { subscription: { select: { name: true } }, status: true },
        },
        userCompanies: {
          include: { role: true },
        },
      },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const current = company.companySubscriptions.find((s) => s.isCurrent);

    return {
      company: {
        id: company.id,
        name: company.name,
        nit: company.nit,
        isActive: company.isActive,
        billing: {
          name: company.billingName,
          lastName: company.billingLastName,
          docNumber: company.billingDocNumber,
          email: company.billingEmail,
          phone: company.billingPhone,
        },
      },
      currentSubscription: current
        ? {
            id: current.id,
            plan: current.subscription?.name,
            studiesPerMonth: current.maxStudiesPerMonthOverride,
            startDate: current.startDate,
            endDate: current.endDate,
            status: current.status?.code,
            contractId: current.contractId,
          }
        : null,
      tiers: company.companySubscriptions.map((s) => ({
        id: s.id,
        studiesPerMonth: s.maxStudiesPerMonthOverride,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status?.code,
        isCurrent: s.isCurrent,
        contractId: s.contractId,
      })),
      users: company.userCompanies.map((uc) => ({
        userId: uc.userId,
        role: uc.role?.code,
        isActive: uc.isActive,
      })),
    };
  }

  /** Consumo del ciclo actual (estudios usados / cupo vigente). */
  async getUsage(companyId: string) {
    const current = await this.prisma.companySubscription.findFirst({
      where: { companyId, isCurrent: true },
    });
    if (!current) {
      throw new NotFoundException(
        'La empresa no tiene una suscripción vigente.',
      );
    }

    const cap = current.maxStudiesPerMonthOverride ?? 0;
    const cycleStart = this.currentCycleStart(current.startDate);

    const used = await this.prisma.creditStudy.count({
      where: { companyId, createdAt: { gte: cycleStart } },
    });

    return {
      studiesPerMonth: cap,
      usedThisCycle: used,
      remaining: Math.max(0, cap - used),
      cycleStart,
    };
  }

  /** Resumen del contrato: total anual comprometido (mes completo al nivel nuevo). */
  async getContractSummary(companyId: string) {
    const current = await this.prisma.companySubscription.findFirst({
      where: { companyId, isCurrent: true },
    });
    if (!current?.contractId) {
      throw new NotFoundException(
        'La empresa no tiene un contrato vigente con tramos.',
      );
    }

    const tiers = await this.prisma.companySubscription.findMany({
      where: { contractId: current.contractId },
      orderBy: { startDate: 'asc' },
    });

    let totalCommitted = 0;
    const breakdown = tiers.map((t) => {
      const months = this.monthsBetweenCeil(t.startDate, t.endDate);
      const level = t.maxStudiesPerMonthOverride ?? 0;
      const subtotal = months * level;
      totalCommitted += subtotal;
      return {
        studiesPerMonth: level,
        startDate: t.startDate,
        endDate: t.endDate,
        months,
        subtotal,
      };
    });

    return {
      contractId: current.contractId,
      totalCommitted,
      breakdown,
    };
  }

  /** Inicio del ciclo mensual vigente, relativo a la fecha de inicio de la suscripción. */
  private currentCycleStart(startDate: Date): Date {
    const now = new Date();
    const start = new Date(startDate);
    // Avanzar mes a mes desde startDate hasta el ciclo que contiene "now".
    const cursor = new Date(start);
    while (true) {
      const nextCycle = new Date(cursor);
      nextCycle.setMonth(nextCycle.getMonth() + 1);
      if (nextCycle > now) break;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return cursor;
  }

  /** Meses entre dos fechas, redondeando hacia arriba (mes completo al nivel nuevo). */
  private monthsBetweenCeil(from: Date, to: Date): number {
    const f = new Date(from);
    const t = new Date(to);
    let months =
      (t.getFullYear() - f.getFullYear()) * 12 +
      (t.getMonth() - f.getMonth());
    if (t.getDate() > f.getDate()) months += 1; // fracción de mes cuenta completa
    return Math.max(1, months);
  }
}
