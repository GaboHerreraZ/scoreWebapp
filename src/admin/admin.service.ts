import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { AnalysisPacksRepository } from '../analysis-packs/analysis-packs.repository.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { CreatePlatformAdminDto } from './dto/create-platform-admin.dto.js';
import { UpdatePlatformAdminDto } from './dto/update-platform-admin.dto.js';

/**
 * Pantallas del panel admin habilitadas por rol (hardcode por ahora; sin tabla
 * de permisos). 'admin' ve todo; el resto (support/sales/sin rol) ve solo lo
 * básico. Cuando se necesite granularidad real, esto pasa a BD.
 */
const ALL_SCREENS = [
  'dashboard',
  'companies',
  'parameters',
  'consultation-prices',
  'pack-offerings',
  'payment-alerts',
  'promo-codes',
  'contact-requests',
  'platform-admins', // gestión de usuarios del portal: SOLO rol admin
] as const;

const BASIC_SCREENS = [
  'companies',
  'payment-alerts',
  'contact-requests',
] as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly analysisPacksRepository: AnalysisPacksRepository,
    private readonly platformAdminRepository: PlatformAdminRepository,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Admins del portal para la pantalla de gestión. Por defecto trae todos
   * (activos e inactivos); onlyActive=true filtra a los activos (selector de
   * asignación de leads).
   */
  async listPlatformAdmins(onlyActive = false) {
    return this.platformAdminRepository.findAdmins(onlyActive);
  }

  /**
   * Datos del admin logueado + pantallas permitidas según su rol. userId es el
   * id de Supabase (del token). Solo 'admin' ve todas; el resto (incl. rol sin
   * asignar) ve las básicas.
   *
   * - 403 si el usuario no es un PlatformAdmin del portal.
   * - 401 si existe pero está DESACTIVADO (borrado lógico): su sesión ya no es
   *   válida para el portal y el front debe redirigir a login.
   */
  async getMyScreens(userId: string) {
    const admin =
      await this.platformAdminRepository.findByUserIdWithRole(userId);
    if (!admin) {
      throw new ForbiddenException('No tienes acceso al portal de administración');
    }
    if (!admin.isActive) {
      throw new UnauthorizedException('Tu cuenta de administrador está desactivada');
    }

    const isAdmin = admin.role?.code === 'admin';
    const allowedScreens = isAdmin ? [...ALL_SCREENS] : [...BASIC_SCREENS];

    return {
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
      },
      allowedScreens,
    };
  }

  // ── Gestión de usuarios del portal (solo rol admin) ───────────────────

  /**
   * Verifica que quien llama (userId de Supabase) sea un PlatformAdmin activo
   * con rol 'admin'. Lanza 403 si no. Gestionar cuentas es exclusivo de admins.
   */
  private async assertCallerIsAdmin(callerUserId: string) {
    const caller =
      await this.platformAdminRepository.findByUserIdWithRole(callerUserId);
    if (!caller || !caller.isActive || caller.role?.code !== 'admin') {
      throw new ForbiddenException(
        'Solo un administrador puede gestionar usuarios del portal',
      );
    }
  }

  /**
   * Crea un usuario del portal: primero en Supabase Auth (email + password,
   * correo dado por confirmado) y luego el PlatformAdmin con sus datos + rol.
   * Si el insert del PlatformAdmin falla, se hace ROLLBACK del usuario de
   * Supabase para no dejar cuentas huérfanas. Solo el rol 'admin' puede crear.
   */
  async createPlatformAdmin(dto: CreatePlatformAdminDto, callerUserId: string) {
    await this.assertCallerIsAdmin(callerUserId);

    // El rol debe existir y ser del tipo correcto.
    const role = await this.platformAdminRepository.findParameterById(dto.roleId);
    if (!role || role.type !== 'platform_admin_role') {
      throw new BadRequestException('roleId inválido (no es un rol de portal)');
    }

    // No duplicar un admin con el mismo correo.
    const existing = await this.platformAdminRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(
        `Ya existe un administrador con el correo ${dto.email}`,
      );
    }

    // 1. Crear el usuario en Supabase (auth).
    const supabaseUserId = await this.supabaseService.createUser(
      dto.email,
      dto.password,
    );

    // 2. Crear el PlatformAdmin; si falla, rollback del usuario de Supabase.
    try {
      return await this.platformAdminRepository.create({
        userId: supabaseUserId,
        email: dto.email,
        name: dto.name,
        phone: dto.phone ?? null,
        roleId: dto.roleId,
        isActive: true,
      });
    } catch (e) {
      this.logger.error(
        `Fallo al crear PlatformAdmin para ${dto.email}; revirtiendo usuario de Supabase ${supabaseUserId}: ${
          (e as Error).message
        }`,
      );
      await this.supabaseService.deleteUser(supabaseUserId);
      throw new InternalServerErrorException(
        'No se pudo crear el administrador; se revirtió el usuario',
      );
    }
  }

  /**
   * Edita los datos de perfil de un PlatformAdmin (name/phone/roleId). No toca
   * email/password (serían cambios en Supabase) ni isActive (ver desactivar).
   * Solo el rol 'admin' puede editar. Valida el rol nuevo si se envía.
   */
  async updatePlatformAdmin(
    id: string,
    dto: UpdatePlatformAdminDto,
    callerUserId: string,
  ) {
    await this.assertCallerIsAdmin(callerUserId);

    const target = await this.platformAdminRepository.findById(id);
    if (!target) {
      throw new NotFoundException(`Administrador con id=${id} no encontrado`);
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.roleId !== undefined) {
      const role = await this.platformAdminRepository.findParameterById(
        dto.roleId,
      );
      if (!role || role.type !== 'platform_admin_role') {
        throw new BadRequestException('roleId inválido (no es un rol de portal)');
      }
      data.roleId = dto.roleId;
    }

    return this.platformAdminRepository.update(id, data);
  }

  /**
   * Desactiva un PlatformAdmin (borrado lógico): isActive=false. NO toca el
   * usuario en Supabase; al intentar usar el portal, /auth/me/screens devuelve
   * 401. Solo el rol 'admin' puede desactivar.
   */
  async deactivatePlatformAdmin(id: string, callerUserId: string) {
    await this.assertCallerIsAdmin(callerUserId);

    const target = await this.platformAdminRepository.findById(id);
    if (!target) {
      throw new NotFoundException(`Administrador con id=${id} no encontrado`);
    }
    return this.platformAdminRepository.setActive(id, false);
  }

  /**
   * Reactiva un PlatformAdmin previamente desactivado (isActive=true). Recupera
   * su acceso al portal. Solo el rol 'admin' puede reactivar.
   */
  async activatePlatformAdmin(id: string, callerUserId: string) {
    await this.assertCallerIsAdmin(callerUserId);

    const target = await this.platformAdminRepository.findById(id);
    if (!target) {
      throw new NotFoundException(`Administrador con id=${id} no encontrado`);
    }
    return this.platformAdminRepository.setActive(id, true);
  }

  /** Saldo de créditos de una empresa: total disponible + nº de bolsas vigentes. */
  private async resolveCredits(companyId: string) {
    const activeStatus =
      await this.parametersRepository.findByTypeAndCode(
        'analysis_pack_status',
        'active',
      );
    if (!activeStatus) {
      return { availableCredits: 0, activePacks: 0, packs: [] as const };
    }

    const packs = await this.analysisPacksRepository.findActivePacksWithBalance(
      companyId,
      activeStatus.id,
    );

    let availableCredits = 0;
    const detail = packs.map((p) => {
      const remaining = p.quantityPurchased - p.quantityConsumed;
      availableCredits += remaining;
      return {
        id: p.id,
        quantityPurchased: p.quantityPurchased,
        quantityConsumed: p.quantityConsumed,
        remaining,
        startDate: p.startDate,
        endDate: p.endDate,
      };
    });

    return { availableCredits, activePacks: packs.length, packs: detail };
  }

  /** Listado cross-tenant de empresas con su saldo de créditos vigente. */
  async listCompanies(params: {
    page: number;
    limit: number;
    search?: string;
  }) {
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
      }),
      this.prisma.company.count({ where }),
    ]);

    const data = await Promise.all(
      companies.map(async (c) => {
        const credits = await this.resolveCredits(c.id);
        return {
          id: c.id,
          name: c.name,
          nit: c.nit,
          isActive: c.isActive,
          availableCredits: credits.availableCredits,
          activePacks: credits.activePacks,
        };
      }),
    );

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Detalle de un cliente: empresa, saldo de créditos, bolsas, usuarios. */
  async getClientDetail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        userCompanies: {
          include: { role: true, user: true },
        },
      },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const credits = await this.resolveCredits(companyId);
    // Historial completo de bolsas (todas, incluidas vencidas/agotadas).
    const allPacks = await this.analysisPacksRepository.findByCompany(companyId);

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
      credits: {
        availableCredits: credits.availableCredits,
        activePacks: credits.activePacks,
      },
      packs: allPacks.map((p) => ({
        id: p.id,
        offering: p.packOffering?.name ?? null,
        quantityPurchased: p.quantityPurchased,
        quantityConsumed: p.quantityConsumed,
        remaining: p.quantityPurchased - p.quantityConsumed,
        totalPaid: p.totalPaid,
        currencyCode: p.currencyCode,
        status: p.status?.code,
        startDate: p.startDate,
        endDate: p.endDate,
        epaycoRef: p.epaycoRef,
        createdAt: p.createdAt,
      })),
      users: company.userCompanies.map((uc) => ({
        userId: uc.userId,
        role: uc.role?.code,
        isActive: uc.isActive,
        invitedBy: uc.invitedBy,
        joinedAt: uc.joinedAt,
        name: uc.user.name,
        email: uc.user.email,
      })),
    };
  }

  /**
   * Saldo de consultas de una empresa: créditos disponibles y detalle de las
   * bolsas vigentes. Reemplaza el antiguo "consumo del ciclo" de suscripción.
   */
  async getUsage(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const credits = await this.resolveCredits(companyId);
    const customersTotal = await this.prisma.customer.count({
      where: { companyId },
    });

    return {
      availableCredits: credits.availableCredits,
      activePacks: credits.activePacks,
      packs: credits.packs,
      customers: { total: customersTotal },
    };
  }

  /**
   * Actividad reciente para soporte: estudios, análisis de IA, extracciones de
   * PDF y customers creados en los últimos 30 días. Antes se anclaba al ciclo de
   * la suscripción; ahora usa una ventana fija de 30 días desde hoy hacia atrás.
   */
  async getCycleActivity(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    // Ventana de 30 días hacia atrás desde hoy (sin dependencia de suscripción).
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 30);
    const inWindow = { gte: windowStart, lte: now };

    const [analysisType, extractionType] = await Promise.all([
      this.parametersRepository.findByCode('creditReview'),
      this.parametersRepository.findByCode('financialStatementsPdfUpload'),
    ]);

    const authorSelect = {
      select: { id: true, name: true, lastName: true, email: true },
    } as const;
    const customerSelect = {
      select: { id: true, businessName: true },
    } as const;

    const aiTypeFilter = [analysisType?.id, extractionType?.id].filter(
      (id): id is number => id != null,
    );

    const [studies, aiAnalyses, customers] = await Promise.all([
      this.prisma.creditStudy.findMany({
        where: { companyId, createdAt: inWindow },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          studyDate: true,
          createdAt: true,
          status: { select: { code: true, label: true } },
          customer: customerSelect,
          createdByUser: authorSelect,
        },
      }),
      this.prisma.aiAnalysis.findMany({
        where: {
          companyId,
          typeId: { in: aiTypeFilter },
          createdAt: inWindow,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          type: { select: { id: true, code: true, label: true } },
          customer: customerSelect,
          performedByUser: authorSelect,
        },
      }),
      this.prisma.customer.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          businessName: true,
          identificationNumber: true,
          createdAt: true,
          createdByUser: authorSelect,
        },
      }),
    ]);

    const fullName = (
      user: { name: string | null; lastName: string | null } | null,
    ) =>
      user ? `${user.name ?? ''} ${user.lastName ?? ''}`.trim() || null : null;

    const mapStudy = (s: (typeof studies)[number]) => ({
      id: s.id,
      studyDate: s.studyDate,
      createdAt: s.createdAt,
      status: s.status?.label ?? null,
      customerName: s.customer?.businessName ?? null,
      createdByName: fullName(s.createdByUser),
      createdByEmail: s.createdByUser?.email ?? null,
    });

    const mapAnalysis = (a: (typeof aiAnalyses)[number]) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      type: a.type?.label ?? null,
      customerName: a.customer?.businessName ?? null,
      performedByName: fullName(a.performedByUser),
      performedByEmail: a.performedByUser?.email ?? null,
    });

    const mapCustomer = (c: (typeof customers)[number]) => ({
      id: c.id,
      businessName: c.businessName,
      identificationNumber: c.identificationNumber,
      createdAt: c.createdAt,
      createdByName: fullName(c.createdByUser),
      createdByEmail: c.createdByUser?.email ?? null,
    });

    const aiAnalysis = analysisType
      ? aiAnalyses.filter((a) => a.type.id === analysisType.id).map(mapAnalysis)
      : [];
    const pdfExtraction = extractionType
      ? aiAnalyses
          .filter((a) => a.type.id === extractionType.id)
          .map(mapAnalysis)
      : [];

    const customersThisWindow = customers.filter(
      (c) => c.createdAt >= windowStart && c.createdAt <= now,
    );

    return {
      windowStart,
      windowEnd: now,
      studies: studies.map(mapStudy),
      aiAnalysis,
      pdfExtraction,
      customers: {
        total: customers.map(mapCustomer),
        createdThisWindow: customersThisWindow.map(mapCustomer),
      },
    };
  }
}
