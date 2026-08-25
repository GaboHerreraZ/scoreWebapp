import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { FilterPlatformUserDto } from './dto/filter-platform-user.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Cuántos registros recientes acompañan a cada contador en la ficha. */
const RECENT_LIMIT = 10;

/**
 * Usuarios del sistema (perfiles de las empresas cliente) vistos desde el
 * portal de administración. NO son los usuarios del portal: esos viven en
 * platform_admins y los gestiona AdminService.
 *
 * Dos vistas: un listado liviano para la tabla y una ficha por id que reúne
 * todo lo que el usuario tiene colgado (empresas, estudios, clientes, consumo
 * de bolsa, consultas a la central, IA, tickets).
 */
@Injectable()
export class PlatformUsersService {
  private readonly logger = new Logger(PlatformUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /** "Juan" + "Pérez" → "Juan Pérez"; sin nada, el correo como respaldo. */
  private fullName(
    name: string | null,
    lastName: string | null,
    email: string,
  ): string {
    const full = [name, lastName].filter(Boolean).join(' ').trim();
    return full || email;
  }

  /**
   * Traduce los filtros a un WHERE. Los tres campos se combinan con AND (más
   * filtros = menos resultados); `search` es la caja única y busca el término
   * en los tres a la vez.
   */
  private buildWhere(filters: FilterPlatformUserDto): Prisma.ProfileWhereInput {
    const insensitive = 'insensitive' as const;
    const conditions: Prisma.ProfileWhereInput[] = [];

    const email = filters.email?.trim();
    if (email) {
      conditions.push({ email: { contains: email, mode: insensitive } });
    }

    const idNumber = filters.identificationNumber?.trim();
    if (idNumber) {
      conditions.push({
        identificationNumber: { contains: idNumber, mode: insensitive },
      });
    }

    // "Juan Pérez" no vive en una sola columna: cada palabra debe aparecer en
    // el nombre o en el apellido, en cualquier orden.
    const name = filters.name?.trim();
    if (name) {
      for (const word of name.split(/\s+/)) {
        conditions.push({
          OR: [
            { name: { contains: word, mode: insensitive } },
            { lastName: { contains: word, mode: insensitive } },
          ],
        });
      }
    }

    const search = filters.search?.trim();
    if (search) {
      conditions.push({
        OR: [
          { email: { contains: search, mode: insensitive } },
          { name: { contains: search, mode: insensitive } },
          { lastName: { contains: search, mode: insensitive } },
          { identificationNumber: { contains: search, mode: insensitive } },
        ],
      });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  /**
   * Listado paginado para la tabla. Trae lo justo para identificar al usuario:
   * ficha básica, empresas a las que pertenece y cuántos estudios ha creado.
   */
  async findAll(filters: FilterPlatformUserDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(filters);

    const [profiles, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          lastName: true,
          phone: true,
          position: true,
          identificationNumber: true,
          createdAt: true,
          identificationType: { select: { code: true, label: true } },
          role: { select: { code: true, label: true } },
          userCompanies: {
            select: {
              isActive: true,
              role: { select: { code: true, label: true } },
              company: { select: { id: true, name: true, nit: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.profile.count({ where }),
    ]);

    // Estudios de TODA la página en una sola query, en vez de un count por fila.
    const ids = profiles.map((p) => p.id);
    const studyCounts = ids.length
      ? await this.prisma.creditStudy.groupBy({
          by: ['createdBy'],
          where: { createdBy: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const studiesByUser = new Map(
      studyCounts.map((s) => [s.createdBy, s._count._all]),
    );

    const data = profiles.map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      lastName: p.lastName,
      fullName: this.fullName(p.name, p.lastName, p.email),
      phone: p.phone,
      position: p.position,
      identificationType: p.identificationType?.label ?? null,
      identificationTypeCode: p.identificationType?.code ?? null,
      identificationNumber: p.identificationNumber,
      role: p.role?.label ?? null,
      roleCode: p.role?.code ?? null,
      companies: p.userCompanies.map((uc) => ({
        id: uc.company.id,
        name: uc.company.name,
        nit: uc.company.nit,
        role: uc.role?.label ?? null,
        isActive: uc.isActive,
      })),
      // La tabla pinta una sola celda: el usuario casi siempre tiene una empresa.
      companiesLabel:
        p.userCompanies.map((uc) => uc.company.name).join(', ') || '—',
      companiesCount: p.userCompanies.length,
      creditStudiesCount: studiesByUser.get(p.id) ?? 0,
      // El Profile no tiene isActive propio: el estado real es el del vínculo
      // con la empresa. Sin ningún vínculo activo, el usuario ya no opera.
      isActive: p.userCompanies.some((uc) => uc.isActive),
      createdAt: p.createdAt,
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Ficha completa: perfil, estado de la cuenta en Supabase Auth, empresas con
   * su rol y toda la actividad que dejó (estudios, clientes, créditos
   * consumidos, consultas a la central, análisis IA, tickets, invitaciones).
   */
  async findOne(id: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        phone: true,
        position: true,
        identificationNumber: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { code: true, label: true } },
        identificationType: { select: { code: true, label: true } },
        userCompanies: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            isActive: true,
            joinedAt: true,
            createdAt: true,
            role: { select: { code: true, label: true } },
            company: {
              select: {
                id: true,
                name: true,
                nit: true,
                isActive: true,
                isOnboardingReady: true,
                logoUrl: true,
                createdAt: true,
              },
            },
            invitedByUser: {
              select: { id: true, name: true, lastName: true, email: true },
            },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(`Usuario con id=${id} no encontrado`);
    }

    const [
      studiesTotal,
      studiesByStatusId,
      recentStudies,
      customersTotal,
      recentCustomers,
      creditsConsumed,
      bureauTotal,
      recentBureau,
      aiStats,
      aiErrors,
      ticketsTotal,
      recentTickets,
      invitationsSent,
      authUser,
    ] = await Promise.all([
      this.prisma.creditStudy.count({ where: { createdBy: id } }),
      this.prisma.creditStudy.groupBy({
        by: ['statusId'],
        where: { createdBy: id },
        _count: { _all: true },
      }),
      this.prisma.creditStudy.findMany({
        where: { createdBy: id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          studyDate: true,
          createdAt: true,
          requestedCreditLine: true,
          requestedTerm: true,
          recommendedCreditLine: true,
          viabilityScore: true,
          viabilityStatus: true,
          status: { select: { code: true, label: true } },
          company: { select: { id: true, name: true } },
          customer: {
            select: {
              id: true,
              businessName: true,
              identificationNumber: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where: { createdBy: id } }),
      this.prisma.customer.findMany({
        where: { createdBy: id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          businessName: true,
          identificationNumber: true,
          email: true,
          createdAt: true,
          personType: { select: { code: true, label: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      // Una consumption = un crédito de bolsa gastado por este usuario.
      this.prisma.analysisConsumption.count({ where: { consumedBy: id } }),
      this.prisma.creditBureauConsultation.count({ where: { createdBy: id } }),
      this.prisma.creditBureauConsultation.findMany({
        where: { createdBy: id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          personType: true,
          numeroIdDigitado: true,
          httpStatus: true,
          txCode: true,
          consultaAt: true,
          createdAt: true,
          company: { select: { id: true, name: true } },
          customer: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.aiAnalysis.aggregate({
        where: { performedBy: id },
        _count: { _all: true },
        _sum: { totalTokens: true, estimatedCostUsd: true },
        _max: { createdAt: true },
      }),
      this.prisma.aiAnalysis.count({
        where: { performedBy: id, status: 'error' },
      }),
      this.prisma.supportTicket.count({ where: { createdBy: id } }),
      this.prisma.supportTicket.findMany({
        where: { createdBy: id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          reference: true,
          subject: true,
          createdAt: true,
          // FKs tipadas del ticket: soporte salta de aquí al estudio o al
          // cliente sin tener que buscarlos por nombre.
          creditStudyId: true,
          customerId: true,
          status: { select: { code: true, label: true } },
          area: { select: { code: true, label: true } },
          priority: { select: { code: true, label: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.invitation.count({ where: { invitedBy: id } }),
      this.getAuthUser(id),
    ]);

    // groupBy devuelve statusId; los labels salen de Parameter en una query.
    const statusIds = studiesByStatusId.map((s) => s.statusId);
    const statusParams = statusIds.length
      ? await this.prisma.parameter.findMany({
          where: { id: { in: statusIds } },
          select: { id: true, code: true, label: true },
        })
      : [];
    const statusById = new Map(statusParams.map((p) => [p.id, p]));

    const lastActivityAt = this.maxDate([
      recentStudies[0]?.createdAt,
      recentCustomers[0]?.createdAt,
      recentBureau[0]?.createdAt,
      recentTickets[0]?.createdAt,
      aiStats._max.createdAt,
    ]);

    return {
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        lastName: profile.lastName,
        fullName: this.fullName(profile.name, profile.lastName, profile.email),
        phone: profile.phone,
        position: profile.position,
        identificationType: profile.identificationType?.label ?? null,
        identificationTypeCode: profile.identificationType?.code ?? null,
        identificationNumber: profile.identificationNumber,
        role: profile.role?.label ?? null,
        roleCode: profile.role?.code ?? null,
        isActive: profile.userCompanies.some((uc) => uc.isActive),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      // Estado de la cuenta en Supabase Auth. null si la consulta falla o el
      // usuario ya no existe allí (perfil huérfano): no rompe la ficha.
      auth: authUser,
      companies: profile.userCompanies.map((uc) => ({
        id: uc.company.id,
        // Id de la fila user_companies: es lo que se toca para arreglar un
        // vínculo mal creado, y no se deduce del par usuario+empresa.
        membershipId: uc.id,
        name: uc.company.name,
        nit: uc.company.nit,
        logoUrl: uc.company.logoUrl,
        isCompanyActive: uc.company.isActive,
        isOnboardingReady: uc.company.isOnboardingReady,
        companyCreatedAt: uc.company.createdAt,
        role: uc.role?.label ?? null,
        roleCode: uc.role?.code ?? null,
        isActive: uc.isActive,
        joinedAt: uc.joinedAt,
        linkedAt: uc.createdAt,
        invitedBy: uc.invitedByUser
          ? {
              id: uc.invitedByUser.id,
              name: this.fullName(
                uc.invitedByUser.name,
                uc.invitedByUser.lastName,
                uc.invitedByUser.email,
              ),
              email: uc.invitedByUser.email,
            }
          : null,
      })),
      activity: {
        creditStudies: {
          total: studiesTotal,
          byStatus: studiesByStatusId
            .map((s) => ({
              code: statusById.get(s.statusId)?.code ?? String(s.statusId),
              label: statusById.get(s.statusId)?.label ?? 'Sin estado',
              count: s._count._all,
            }))
            .sort((a, b) => b.count - a.count),
        },
        customers: { total: customersTotal },
        creditsConsumed,
        bureauConsultations: { total: bureauTotal },
        aiAnalyses: {
          total: aiStats._count._all,
          errors: aiErrors,
          totalTokens: aiStats._sum.totalTokens ?? 0,
          estimatedCostUsd: aiStats._sum.estimatedCostUsd ?? 0,
        },
        supportTickets: { total: ticketsTotal },
        invitationsSent,
        lastActivityAt,
      },
      creditStudies: recentStudies.map((s) => ({
        id: s.id,
        company: s.company.name,
        companyId: s.company.id,
        customer: s.customer.businessName,
        customerId: s.customer.id,
        customerIdentification: s.customer.identificationNumber,
        status: s.status.label,
        statusCode: s.status.code,
        viabilityStatus: s.viabilityStatus,
        viabilityScore: s.viabilityScore,
        requestedCreditLine: s.requestedCreditLine,
        requestedTerm: s.requestedTerm,
        recommendedCreditLine: s.recommendedCreditLine,
        studyDate: s.studyDate,
        createdAt: s.createdAt,
      })),
      customers: recentCustomers.map((c) => ({
        id: c.id,
        businessName: c.businessName,
        identificationNumber: c.identificationNumber,
        email: c.email,
        personType: c.personType.label,
        company: c.company.name,
        companyId: c.company.id,
        createdAt: c.createdAt,
      })),
      bureauConsultations: recentBureau.map((b) => ({
        id: b.id,
        personType: b.personType,
        identificationNumber: b.numeroIdDigitado,
        customer: b.customer.businessName,
        customerId: b.customer.id,
        company: b.company.name,
        companyId: b.company.id,
        httpStatus: b.httpStatus,
        txCode: b.txCode,
        // La central responde 200 con código de error; ambos importan.
        ok: b.httpStatus >= 200 && b.httpStatus < 300,
        consultaAt: b.consultaAt,
        createdAt: b.createdAt,
      })),
      supportTickets: recentTickets.map((t) => ({
        id: t.id,
        reference: t.reference,
        subject: t.subject,
        status: t.status.label,
        statusCode: t.status.code,
        area: t.area.label,
        priority: t.priority.label,
        company: t.company.name,
        companyId: t.company.id,
        creditStudyId: t.creditStudyId,
        customerId: t.customerId,
        createdAt: t.createdAt,
      })),
    };
  }

  /**
   * Estado de la cuenta en Supabase Auth (último ingreso, confirmación de
   * correo). Best-effort: si la API falla o el usuario no existe allí devuelve
   * null en vez de tumbar la ficha.
   */
  private async getAuthUser(userId: string) {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .auth.admin.getUserById(userId);
      if (error || !data?.user) return null;

      const user = data.user;
      return {
        lastSignInAt: user.last_sign_in_at ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
        createdAt: user.created_at ?? null,
        providers: (user.app_metadata?.providers as string[]) ?? [],
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el usuario ${userId} de Supabase Auth: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      return null;
    }
  }

  private maxDate(dates: (Date | null | undefined)[]): Date | null {
    const valid = dates.filter((d): d is Date => d instanceof Date);
    if (!valid.length) return null;
    return valid.reduce((a, b) => (a > b ? a : b));
  }
}
