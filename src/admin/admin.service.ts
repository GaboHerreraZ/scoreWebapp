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
import { ResetCreditStudyDto } from './dto/reset-credit-study.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { LOCKED_STUDY_STATUSES } from '../credit-studies/credit-study-status.constants.js';

/**
 * Pantallas del panel admin habilitadas por rol (hardcode por ahora; sin tabla
 * de permisos). Cuando se necesite granularidad real, esto pasa a BD.
 *
 * - 'admin' ve TODO (ALL_SCREENS).
 * - el resto parte de un set base común y suma extras según su rol:
 *     · 'support' suma 'support-tickets' (gestiona el soporte).
 *     · 'sales' y sin rol solo el base.
 */
const ALL_SCREENS = [
  'dashboard',
  'companies',
  'parameters',
  'consultation-prices',
  'pack-offerings',
  'payment-alerts',
  'promo-codes',
  'einvoices',
  'contact-requests',
  'support-tickets',
  'platform-admins', // gestión de usuarios del portal: SOLO rol admin
  'blog-posts',
  'scoring-dimensions',
  'datacredito',
  'discount-calculator',
  'credit-study-resets',
  'pdf-extraction-test',
  'datacredito-connection',
] as const;

// Bucket de Supabase Storage para las fotos de los usuarios del portal.
const PLATFORM_ADMIN_AVATAR_BUCKET = 'platform-admin-avatars';

// Pantallas que ve cualquier usuario no-admin del portal.
const BASE_SCREENS = [
  'companies',
  'payment-alerts',
  'contact-requests',
  'support-tickets',
  'pdf-extraction-test',
  'einvoices'
];

// Ventana hacia adelante para marcar créditos "en riesgo de vencer" en /usage.
const EXPIRY_RISK_DAYS = 30;

// Un estudio en estado intermedio del flujo por más de estos días se marca
// "atascado" en /cycle-activity (señal de fricción/abandono para soporte).
const STUCK_STUDY_DAYS = 3;
const PENDING_STUDY_STATUSES = [
  'pendingFinancialStatements',
  'pendingStudyAnalysis',
];

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
      throw new ForbiddenException(
        'No tienes acceso al portal de administración',
      );
    }
    if (!admin.isActive) {
      throw new UnauthorizedException(
        'Tu cuenta de administrador está desactivada',
      );
    }

    // admin ve todo; el resto (support/sales/sin rol) ve el set base.
    const allowedScreens =
      admin.role?.code === 'admin' ? [...ALL_SCREENS] : [...BASE_SCREENS];

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
    const role = await this.platformAdminRepository.findParameterById(
      dto.roleId,
    );
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
        throw new BadRequestException(
          'roleId inválido (no es un rol de portal)',
        );
      }
      data.roleId = dto.roleId;
    }

    return this.platformAdminRepository.update(id, data);
  }

  /**
   * Sube la foto de un PlatformAdmin a Supabase Storage y guarda su path en
   * avatarUrl. upsert por path fijo ({id}/avatar.{ext}) → re-subir reemplaza.
   * Devuelve el path guardado y una URL firmada de cortesía para previsualizar.
   * Solo el rol 'admin' puede hacerlo.
   */
  async uploadAvatar(
    id: string,
    file: Express.Multer.File,
    callerUserId: string,
  ) {
    await this.assertCallerIsAdmin(callerUserId);

    const target = await this.platformAdminRepository.findById(id);
    if (!target) {
      throw new NotFoundException(`Administrador con id=${id} no encontrado`);
    }

    const ext = file.originalname.split('.').pop() ?? 'png';
    const storagePath = `${id}/avatar.${ext}`;

    await this.supabaseService.uploadFile(
      PLATFORM_ADMIN_AVATAR_BUCKET,
      storagePath,
      file.buffer,
      file.mimetype,
    );

    const updated = await this.platformAdminRepository.update(id, {
      avatarUrl: storagePath,
    });

    const avatarSignedUrl = await this.supabaseService.createSignedUrl(
      PLATFORM_ADMIN_AVATAR_BUCKET,
      storagePath,
    );

    return { ...updated, avatarSignedUrl };
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
    const activeStatus = await this.parametersRepository.findByTypeAndCode(
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

    // Saldo de créditos de TODA la página en 2 queries (status + packs en
    // lote), en vez de resolveCredits por empresa (2 queries por fila).
    const activeStatus = await this.parametersRepository.findByTypeAndCode(
      'analysis_pack_status',
      'active',
    );
    const packsByCompany = new Map<
      string,
      { availableCredits: number; activePacks: number }
    >();
    if (activeStatus) {
      const packs =
        await this.analysisPacksRepository.findActivePacksWithBalanceForCompanies(
          companies.map((c) => c.id),
          activeStatus.id,
        );
      for (const p of packs) {
        const entry = packsByCompany.get(p.companyId) ?? {
          availableCredits: 0,
          activePacks: 0,
        };
        entry.availableCredits += p.quantityPurchased - p.quantityConsumed;
        entry.activePacks += 1;
        packsByCompany.set(p.companyId, entry);
      }
    }

    const data = companies.map((c) => {
      const credits = packsByCompany.get(c.id) ?? {
        availableCredits: 0,
        activePacks: 0,
      };
      return {
        id: c.id,
        name: c.name,
        nit: c.nit,
        isActive: c.isActive,
        availableCredits: credits.availableCredits,
        activePacks: credits.activePacks,
      };
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Detalle de un cliente: ficha general de la empresa (identidad, ubicación,
   * sector, cuenta bancaria, facturación, contrato macro, configuración de
   * scoring y semáforo de setup) + saldo de créditos, bolsas y usuarios.
   */
  async getClientDetail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        sector: { select: { code: true, label: true } },
        accountType: { select: { code: true, label: true } },
        accountBank: { select: { code: true, label: true } },
        billingDocType: { select: { code: true, label: true } },
        contractSignature: {
          select: {
            status: { select: { code: true, label: true } },
            signerName: true,
            signerEmail: true,
            sentAt: true,
            signedAt: true,
            refusedAt: true,
            refusedReason: true,
            firstViewedAt: true,
            lastViewedAt: true,
            viewCount: true,
          },
        },
        scoringConfigurations: {
          where: { isActive: true },
          select: {
            personType: { select: { code: true, label: true } },
            weights: {
              select: {
                weight: true,
                dimension: { select: { code: true, label: true } },
              },
              orderBy: { dimension: { sortOrder: 'asc' } },
            },
            createdAt: true,
          },
        },
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
    const allPacks =
      await this.analysisPacksRepository.findByCompany(companyId);

    const contract = company.contractSignature;

    return {
      company: {
        id: company.id,
        name: company.name,
        nit: company.nit,
        isActive: company.isActive,
        isOnboardingReady: company.isOnboardingReady,
        sector: company.sector.label,
        location: {
          state: company.state,
          city: company.city,
          address: company.address,
        },
        logoUrl: company.logoUrl,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
        bankAccount: {
          bank: company.accountBank?.label ?? null,
          type: company.accountType?.label ?? null,
          number: company.accountNumber,
        },
        billing: {
          name: company.billingName,
          lastName: company.billingLastName,
          businessName: company.billingBusinessName,
          docType: company.billingDocType?.label ?? null,
          docNumber: company.billingDocNumber,
          email: company.billingEmail,
          phone: company.billingPhone,
          address: company.billingAddress,
          state: company.billingState,
          city: company.billingCity,
        },
        providerCustomerId: company.providerCustomerId,
      },
      // Contrato macro (Zapsign): estado, firmante y seguimiento de visualización
      // ("lo abrió pero no firma" es señal comercial). null = nunca se envió.
      contract: contract
        ? {
            status: contract.status?.label ?? null,
            statusCode: contract.status?.code ?? null,
            signerName: contract.signerName,
            signerEmail: contract.signerEmail,
            sentAt: contract.sentAt,
            signedAt: contract.signedAt,
            refusedAt: contract.refusedAt,
            refusedReason: contract.refusedReason,
            firstViewedAt: contract.firstViewedAt,
            lastViewedAt: contract.lastViewedAt,
            viewCount: contract.viewCount,
          }
        : null,
      // Configs de scoring vigentes (una por tipo de persona) con sus
      // dimensiones HABILITADAS y pesos (suman 100). Una dimensión ausente está
      // deshabilitada. Vacío = la empresa aún no puede correr estudios.
      scoring: company.scoringConfigurations.map((sc) => ({
        personType: sc.personType.label,
        personTypeCode: sc.personType.code,
        weights: Object.fromEntries(
          sc.weights.map((w) => [w.dimension.code, w.weight]),
        ),
        dimensions: sc.weights.map((w) => ({
          code: w.dimension.code,
          label: w.dimension.label,
          weight: w.weight,
        })),
        configuredAt: sc.createdAt,
      })),
      // Semáforo de setup: lo que le falta a la empresa para operar completa.
      setup: {
        isOnboardingReady: company.isOnboardingReady,
        contractSigned: Boolean(contract?.signedAt),
        scoringConfigured: company.scoringConfigurations.length > 0,
        hasCredits: credits.availableCredits > 0,
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
        providerReference: p.providerReference,
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
   * Salud de la cuenta de una empresa (vista de dinero): saldo de créditos y
   * bolsas vigentes + ritmo de consumo real (AnalysisConsumption) con proyección
   * de agotamiento, créditos en riesgo de vencer sin usar, desglose por usuario
   * y totales históricos.
   */
  async getUsage(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const now = new Date();
    const daysAgo = (days: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      return d;
    };
    const from30 = daysAgo(30);
    const from90 = daysAgo(90);
    const expiryLimit = new Date(now);
    expiryLimit.setDate(expiryLimit.getDate() + EXPIRY_RISK_DAYS);

    const [
      credits,
      customersTotal,
      consumed30,
      consumed90,
      byUserRaw,
      lifetime,
    ] = await Promise.all([
      this.resolveCredits(companyId),
      this.prisma.customer.count({ where: { companyId } }),
      this.prisma.analysisConsumption.count({
        where: { companyId, createdAt: { gte: from30 } },
      }),
      this.prisma.analysisConsumption.count({
        where: { companyId, createdAt: { gte: from90 } },
      }),
      this.prisma.analysisConsumption.groupBy({
        by: ['consumedBy'],
        where: { companyId, createdAt: { gte: from90 } },
        _count: { id: true },
      }),
      this.prisma.analysisPack.aggregate({
        where: { companyId },
        _sum: { quantityPurchased: true, quantityConsumed: true },
      }),
    ]);

    // Nombres de quienes consumen (desglose últimos 90 días).
    const userIds = byUserRaw.map((u) => u.consumedBy);
    const profiles = userIds.length
      ? await this.prisma.profile.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, lastName: true, email: true },
        })
      : [];
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const byUser = byUserRaw
      .map((u) => {
        const p = profileById.get(u.consumedBy);
        return {
          userId: u.consumedBy,
          name: p ? `${p.name ?? ''} ${p.lastName ?? ''}`.trim() || null : null,
          email: p?.email ?? null,
          consumed: u._count.id,
        };
      })
      .sort((a, b) => b.consumed - a.consumed);

    // Ritmo y proyección sobre la ventana de 30 días. Sin consumo reciente no
    // hay proyección (null = "no se puede estimar", distinto de "no se agota").
    const dailyRate = consumed30 / 30;
    const projectedRunOutDays =
      dailyRate > 0 ? Math.floor(credits.availableCredits / dailyRate) : null;

    // Créditos que se pierden si no se usan antes del vencimiento cercano.
    const expiringSoonCredits = credits.packs
      .filter((p) => p.endDate <= expiryLimit)
      .reduce((sum, p) => sum + p.remaining, 0);

    return {
      credits: {
        availableCredits: credits.availableCredits,
        activePacks: credits.activePacks,
        packs: credits.packs,
        expiringSoon: {
          withinDays: EXPIRY_RISK_DAYS,
          credits: expiringSoonCredits,
        },
      },
      consumption: {
        last30Days: consumed30,
        last90Days: consumed90,
        weeklyRate: Math.round((consumed30 / 30) * 7 * 10) / 10,
        projectedRunOutDays,
        byUser,
      },
      lifetime: {
        totalPurchased: lifetime._sum.quantityPurchased ?? 0,
        totalConsumed: lifetime._sum.quantityConsumed ?? 0,
      },
      customers: { total: customersTotal },
    };
  }

  /**
   * Actividad reciente para soporte/operación: estudios (con veredicto y marca
   * de atascado), consultas a la central (con fallos), análisis de IA y
   * extracciones de PDF (con costo/errores) y customers creados en la ventana.
   * Abre con un bloque `summary` de lectura rápida antes de las listas.
   */
  async getCycleActivity(companyId: string, windowDays = 30) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - windowDays);
    const inWindow = { gte: windowStart, lte: now };
    const stuckBefore = new Date(now);
    stuckBefore.setDate(stuckBefore.getDate() - STUCK_STUDY_DAYS);

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

    const [
      studies,
      consultations,
      aiAnalyses,
      customersWindow,
      customersTotal,
    ] = await Promise.all([
      this.prisma.creditStudy.findMany({
        where: { companyId, createdAt: inWindow },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          studyDate: true,
          createdAt: true,
          viabilityScore: true,
          viabilityStatus: true,
          status: { select: { code: true, label: true } },
          customer: customerSelect,
          createdByUser: authorSelect,
        },
      }),
      this.prisma.creditBureauConsultation.findMany({
        where: { companyId, createdAt: inWindow },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          consultaAt: true,
          createdAt: true,
          personType: true,
          provider: true,
          txCode: true,
          httpStatus: true,
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
          errorMessage: true,
          estimatedCostUsd: true,
          durationMs: true,
          createdAt: true,
          type: { select: { id: true, code: true, label: true } },
          customer: customerSelect,
          performedByUser: authorSelect,
        },
      }),
      this.prisma.customer.findMany({
        where: { companyId, createdAt: inWindow },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          businessName: true,
          identificationNumber: true,
          createdAt: true,
          createdByUser: authorSelect,
        },
      }),
      this.prisma.customer.count({ where: { companyId } }),
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
      statusCode: s.status?.code ?? null,
      viabilityScore: s.viabilityScore,
      viabilityStatus: s.viabilityStatus,
      stuck:
        PENDING_STUDY_STATUSES.includes(s.status?.code ?? '') &&
        s.createdAt < stuckBefore,
      customerName: s.customer?.businessName ?? null,
      createdByName: fullName(s.createdByUser),
      createdByEmail: s.createdByUser?.email ?? null,
    });

    const mapConsultation = (c: (typeof consultations)[number]) => ({
      id: c.id,
      consultaAt: c.consultaAt,
      createdAt: c.createdAt,
      provider: c.provider,
      personType: c.personType,
      txCode: c.txCode,
      httpStatus: c.httpStatus,
      failed: c.httpStatus >= 400,
      customerName: c.customer?.businessName ?? null,
      createdByName: fullName(c.createdByUser),
      createdByEmail: c.createdByUser?.email ?? null,
    });

    const mapAnalysis = (a: (typeof aiAnalyses)[number]) => ({
      id: a.id,
      status: a.status,
      errorMessage: a.errorMessage,
      estimatedCostUsd: a.estimatedCostUsd,
      durationMs: a.durationMs,
      createdAt: a.createdAt,
      type: a.type?.label ?? null,
      customerName: a.customer?.businessName ?? null,
      performedByName: fullName(a.performedByUser),
      performedByEmail: a.performedByUser?.email ?? null,
    });

    const mapCustomer = (c: (typeof customersWindow)[number]) => ({
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

    const mappedStudies = studies.map(mapStudy);
    const mappedConsultations = consultations.map(mapConsultation);
    const aiCostUsd =
      Math.round(
        aiAnalyses.reduce((sum, a) => sum + (a.estimatedCostUsd ?? 0), 0) * 100,
      ) / 100;

    return {
      window: { start: windowStart, end: now, days: windowDays },
      summary: {
        studies: mappedStudies.length,
        stuckStudies: mappedStudies.filter((s) => s.stuck).length,
        bureauConsultations: mappedConsultations.length,
        failedConsultations: mappedConsultations.filter((c) => c.failed).length,
        aiAnalysis: aiAnalysis.length,
        pdfExtraction: pdfExtraction.length,
        aiErrors: aiAnalyses.filter((a) => a.status === 'error').length,
        aiCostUsd,
        customersCreated: customersWindow.length,
      },
      studies: mappedStudies,
      bureauConsultations: mappedConsultations,
      aiAnalysis,
      pdfExtraction,
      customers: {
        total: customersTotal,
        createdThisWindow: customersWindow.map(mapCustomer),
      },
    };
  }

  // ── Reset de estudio (soporte) ───────────────────────────

  /**
   * Resetea un estudio al paso 2 (carga de EEFF) cuando un dato mal leído por
   * la extracción llegó por ticket de soporte. Antes de limpiar, congela un
   * snapshot COMPLETO del estado previo en credit_study_resets (ticket + motivo
   * + resultado + análisis congelados); luego borra los análisis del estudio
   * (join + períodos + indicadores — sin duplicados al re-cargar), limpia el
   * resultado de viabilidad y devuelve el estado a 'pendingFinancialStatements'.
   * La consulta al bureau NO se toca: el re-análisis reutiliza el snapshot de
   * riesgo vigente sin consumir bolsa. Los AiAnalysis (log de extracciones)
   * tampoco: son la evidencia para diagnosticar el prompt.
   */
  async resetCreditStudy(
    creditStudyId: string,
    dto: ResetCreditStudyDto,
    adminUserId: string,
  ) {
    const study = await this.prisma.creditStudy.findUnique({
      where: { id: creditStudyId },
      include: {
        status: { select: { code: true, label: true } },
        customer: {
          select: { businessName: true, identificationNumber: true },
        },
        financialAnalyses: {
          include: {
            financialAnalysis: {
              include: { periods: { orderBy: { fiscalYear: 'desc' } } },
            },
          },
        },
      },
    });
    if (!study) {
      throw new NotFoundException(
        `Estudio de crédito con id=${creditStudyId} no encontrado`,
      );
    }
    if (study.status?.code && LOCKED_STUDY_STATUSES.has(study.status.code)) {
      throw new BadRequestException(
        'No se puede resetear un estudio confirmado, en firma o cerrado.',
      );
    }

    const pendingStatus = await this.parametersRepository.findByCode(
      'pendingFinancialStatements',
    );
    if (!pendingStatus) {
      throw new BadRequestException(
        'Falta el parámetro pendingFinancialStatements: no se puede regresar el estudio al paso de carga de EEFF.',
      );
    }

    // Ticket de soporte (opcional): debe existir y ser de la MISMA empresa que
    // el estudio. Queda como FK en la auditoría.
    let supportTicket: { id: string; reference: string } | null = null;
    if (dto.supportTicketId) {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: dto.supportTicketId },
        select: {
          id: true,
          reference: true,
          companyId: true,
          creditStudyId: true,
        },
      });
      if (!ticket) {
        throw new NotFoundException(
          `Ticket de soporte con id=${dto.supportTicketId} no encontrado`,
        );
      }
      if (ticket.companyId !== study.companyId) {
        throw new BadRequestException(
          'El ticket de soporte pertenece a otra empresa distinta a la del estudio.',
        );
      }
      // Si el ticket está vinculado a un estudio (área credit_study), debe ser
      // EL MISMO que se resetea — evita cruzar auditorías de tickets ajenos.
      if (ticket.creditStudyId && ticket.creditStudyId !== creditStudyId) {
        throw new BadRequestException(
          'El ticket de soporte está vinculado a otro estudio de crédito.',
        );
      }
      supportTicket = { id: ticket.id, reference: ticket.reference };
    }

    const analyses = study.financialAnalyses.map((j) => j.financialAnalysis);
    const analysisIds = analyses.map((a) => a.id);

    // Estado previo completo (forense): lo que el estudio decía ANTES del reset.
    const snapshot = {
      study: {
        statusCode: study.status?.code ?? null,
        requestedCreditLine: study.requestedCreditLine,
        requestedTerm: study.requestedTerm,
        viabilityScore: study.viabilityScore,
        viabilityStatus: study.viabilityStatus,
        viabilityConditions: study.viabilityConditions,
        recommendedCreditLine: study.recommendedCreditLine,
        recommendedTerm: study.recommendedTerm,
        resolutionDate: study.resolutionDate,
        scoringConfigurationId: study.scoringConfigurationId,
      },
      frozenAnalyses: analyses,
    };

    const reset = await this.prisma.$transaction(async (tx) => {
      const resetRow = await tx.creditStudyReset.create({
        data: {
          creditStudyId,
          companyId: study.companyId,
          supportTicketId: supportTicket?.id ?? null,
          reason: dto.reason,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          resetBy: adminUserId,
        },
      });

      await tx.creditStudyFinancialAnalysis.deleteMany({
        where: { creditStudyId },
      });

      if (analysisIds.length > 0) {
        // Un análisis congelado también en OTRO estudio (la join lo permite)
        // solo se desprende de este; se borran únicamente los huérfanos.
        const stillReferenced = await tx.creditStudyFinancialAnalysis.findMany({
          where: { financialAnalysisId: { in: analysisIds } },
          select: { financialAnalysisId: true },
        });
        const referenced = new Set(
          stillReferenced.map((r) => r.financialAnalysisId),
        );
        const orphanIds = analysisIds.filter((id) => !referenced.has(id));
        if (orphanIds.length > 0) {
          await tx.financialStatementPeriod.deleteMany({
            where: { analysisId: { in: orphanIds } },
          });
          await tx.financialAnalysis.deleteMany({
            where: { id: { in: orphanIds } },
          });
        }
      }

      await tx.creditStudy.update({
        where: { id: creditStudyId },
        data: {
          viabilityScore: null,
          viabilityStatus: null,
          viabilityConditions: Prisma.DbNull,
          recommendedCreditLine: null,
          recommendedTerm: null,
          resolutionDate: null,
          scoringConfigurationId: null,
          statusId: pendingStatus.id,
        },
      });

      return resetRow;
    });

    return {
      success: true,
      resetId: reset.id,
      creditStudyId,
      customer: study.customer.businessName,
      previousStatus: study.status?.code ?? null,
      newStatus: 'pendingFinancialStatements',
      removedAnalyses: analysisIds.length,
      supportTicket,
    };
  }

  /**
   * Listado de resets de estudio (auditoría), del más reciente al más antiguo.
   * Datos mínimos por fila: empresa, cliente y solicitud del estudio (con su
   * estado ACTUAL — permite ver si ya se re-analizó), ticket (referencia,
   * asunto, descripción), motivo y quién lo ejecutó. El snapshot pesado NO se
   * incluye aquí: se sirve en el detalle por id.
   */
  async listCreditStudyResets() {
    const resets = await this.prisma.creditStudyReset.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        reason: true,
        resetBy: true,
        supportTicket: {
          select: {
            id: true,
            reference: true,
            subject: true,
            description: true,
          },
        },
        creditStudy: {
          select: {
            id: true,
            requestedCreditLine: true,
            requestedTerm: true,
            studyDate: true,
            viabilityStatus: true,
            status: { select: { code: true, label: true } },
            customer: {
              select: { businessName: true, identificationNumber: true },
            },
            company: { select: { id: true, name: true } },
          },
        },
      },
    });

    const adminsById = await this.platformAdminsByUserId(
      resets.map((r) => r.resetBy),
    );

    return resets.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      reason: r.reason,
      resetBy: adminsById.get(r.resetBy) ?? { userId: r.resetBy, name: null },
      company: r.creditStudy.company,
      creditStudy: {
        id: r.creditStudy.id,
        customer: r.creditStudy.customer.businessName,
        identificationNumber: r.creditStudy.customer.identificationNumber,
        requestedCreditLine: r.creditStudy.requestedCreditLine,
        requestedTerm: r.creditStudy.requestedTerm,
        studyDate: r.creditStudy.studyDate,
        // Estado HOY (no el del momento del reset): si ya volvió a
        // studyCompleted es que el usuario re-cargó y re-analizó.
        currentStatus: r.creditStudy.status
          ? {
              code: r.creditStudy.status.code,
              label: r.creditStudy.status.label,
            }
          : null,
        currentViabilityStatus: r.creditStudy.viabilityStatus,
      },
      supportTicket: r.supportTicket,
    }));
  }

  /**
   * Detalle de un reset: todo lo del listado + el SNAPSHOT completo del estado
   * previo (resultado de viabilidad, status al momento del reset, solicitud y
   * los análisis financieros congelados que se desecharon) y el estado actual
   * del estudio para contrastar el antes/después.
   */
  async getCreditStudyReset(resetId: string) {
    const reset = await this.prisma.creditStudyReset.findUnique({
      where: { id: resetId },
      include: {
        supportTicket: {
          select: {
            id: true,
            reference: true,
            subject: true,
            description: true,
            createdAt: true,
            status: { select: { code: true, label: true } },
            priority: { select: { code: true, label: true } },
          },
        },
        creditStudy: {
          select: {
            id: true,
            requestedCreditLine: true,
            requestedTerm: true,
            studyDate: true,
            viabilityScore: true,
            viabilityStatus: true,
            recommendedCreditLine: true,
            resolutionDate: true,
            status: { select: { code: true, label: true } },
            customer: {
              select: { businessName: true, identificationNumber: true },
            },
            company: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!reset) {
      throw new NotFoundException(
        `Reset de estudio con id=${resetId} no encontrado`,
      );
    }

    const adminsById = await this.platformAdminsByUserId([reset.resetBy]);
    const snapshot = reset.snapshot as {
      study?: { statusCode?: string | null };
    } | null;

    return {
      id: reset.id,
      createdAt: reset.createdAt,
      reason: reset.reason,
      resetBy: adminsById.get(reset.resetBy) ?? {
        userId: reset.resetBy,
        name: null,
      },
      company: reset.creditStudy.company,
      supportTicket: reset.supportTicket,
      // Estado al momento del reset (sale del snapshot congelado).
      previousStatus: snapshot?.study?.statusCode ?? null,
      // Estado ACTUAL del estudio (para el antes/después: si viability* ya no
      // está null es que el usuario re-cargó EEFF y re-analizó).
      creditStudy: {
        id: reset.creditStudy.id,
        customer: reset.creditStudy.customer.businessName,
        identificationNumber: reset.creditStudy.customer.identificationNumber,
        requestedCreditLine: reset.creditStudy.requestedCreditLine,
        requestedTerm: reset.creditStudy.requestedTerm,
        studyDate: reset.creditStudy.studyDate,
        currentStatus: reset.creditStudy.status
          ? {
              code: reset.creditStudy.status.code,
              label: reset.creditStudy.status.label,
            }
          : null,
        currentViabilityScore: reset.creditStudy.viabilityScore,
        currentViabilityStatus: reset.creditStudy.viabilityStatus,
        currentRecommendedCreditLine: reset.creditStudy.recommendedCreditLine,
        currentResolutionDate: reset.creditStudy.resolutionDate,
      },
      // Estado previo COMPLETO congelado al resetear: study (viability*,
      // solicitud, status) + frozenAnalyses (indicadores, ratios, red flags y
      // períodos de cada fuente desechada).
      snapshot: reset.snapshot,
    };
  }

  // ── Facturación electrónica ───────────────────────────────────────────────
  // La factura se emite FUERA del sistema (proveedor de FE / contabilidad) y
  // aquí solo se lleva la cola: qué ventas están cobradas y aún sin facturar, y
  // el registro de cuál factura las cubrió. Nunca entran las bolsas sin costo
  // (totalPaid = 0): no hubo pago, no hay nada que facturar.

  /**
   * Ventas cobradas para conciliar con facturación, con TODO lo que necesita el
   * documento: adquiriente (datos fiscales de la empresa), concepto, desglose
   * base/IVA congelado y referencia del recaudo.
   *
   * @param pending true (default) = solo las que faltan por facturar.
   */
  async listEinvoices(params: {
    page?: number;
    limit?: number;
    pending?: boolean;
    search?: string;
  }) {
    // Los query params llegan como texto: un valor no numérico se ignora en vez
    // de propagar un NaN al skip/take (que reventaría en 500).
    const page =
      Number.isFinite(params.page) && params.page! > 0 ? params.page! : 1;
    const limit =
      Number.isFinite(params.limit) && params.limit! > 0
        ? Math.min(params.limit!, 200)
        : 20;

    const where: Prisma.AnalysisPackWhereInput = {
      // Solo ventas reales y ya confirmadas por la pasarela.
      totalPaid: { gt: 0 },
      paidAt: { not: null },
      // Se excluyen las que NO representan un cobro firme: pending_payment (aún
      // sin confirmar, o devuelta ahí por una reversa) y cancelled. Una bolsa
      // vencida o agotada sí se factura: el cobro existió.
      status: {
        type: 'analysis_pack_status',
        code: { notIn: ['pending_payment', 'cancelled'] },
      },
    };
    if (params.pending !== false) {
      where.einvoiceSent = false;
    }
    if (params.search?.trim()) {
      const search = params.search.trim();
      where.company = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { nit: { contains: search, mode: 'insensitive' } },
          { billingBusinessName: { contains: search, mode: 'insensitive' } },
          { billingDocNumber: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [rows, total, totals] = await Promise.all([
      this.prisma.analysisPack.findMany({
        where,
        orderBy: { paidAt: 'asc' }, // lo más viejo primero: es una cola
        skip: (page - 1) * limit,
        take: limit,
        include: {
          packOffering: { select: { name: true } },
          status: { select: { code: true, label: true } },
          einvoiceMarkedByAdmin: { select: { name: true, email: true } },
          company: {
            select: {
              id: true,
              name: true,
              nit: true,
              billingBusinessName: true,
              billingName: true,
              billingLastName: true,
              billingDocTypeId: true,
              billingDocNumber: true,
              billingEmail: true,
              billingPhone: true,
              billingAddress: true,
              billingCity: true,
              billingState: true,
            },
          },
        },
      }),
      this.prisma.analysisPack.count({ where }),
      // Totales de la selección completa (no solo de la página), para cuadrar
      // contra lo que reporte contabilidad.
      this.prisma.analysisPack.aggregate({
        where,
        _sum: { totalPaid: true, taxBase: true, taxAmount: true },
      }),
    ]);

    const data = rows.map((p) => {
      const c = p.company;
      // Nombre fiscal: razón social (jurídica) → nombre+apellido (natural) →
      // nombre comercial de la cuenta.
      const billingName =
        c.billingBusinessName ||
        [c.billingName, c.billingLastName].filter(Boolean).join(' ').trim() ||
        c.name;

      return {
        analysisPackId: p.id,
        paidAt: p.paidAt,
        // Adquiriente (lo que va en la factura).
        customer: {
          companyId: c.id,
          companyName: c.name,
          nit: c.nit,
          billingName,
          billingDocTypeId: c.billingDocTypeId,
          billingDocNumber: c.billingDocNumber,
          billingEmail: c.billingEmail,
          billingPhone: c.billingPhone,
          billingAddress: c.billingAddress,
          billingCity: c.billingCity,
          billingState: c.billingState,
        },
        // Concepto.
        item: {
          name: p.packOffering?.name ?? 'Bolsa de consultas',
          quantity: p.quantityPurchased,
          unitPrice: p.unitPricePaid,
        },
        // Valores CONGELADOS al cobrar (base + IVA = total).
        amounts: {
          taxRate: Number(p.taxRatePaid ?? 0),
          taxBase: p.taxBase ?? p.totalPaid,
          taxAmount: p.taxAmount ?? 0,
          total: p.totalPaid,
          currency: p.currencyCode,
        },
        // Recaudo, para conciliar con el extracto de la pasarela.
        payment: {
          provider: p.provider,
          providerReference: p.providerReference,
          providerTransactionId: p.providerTransactionId,
          franchise: p.providerFranchise,
          isTest: p.isTest,
        },
        einvoice: {
          sent: p.einvoiceSent,
          sentAt: p.einvoiceSentAt,
          number: p.einvoiceNumber,
          markedBy:
            p.einvoiceMarkedByAdmin?.name ??
            p.einvoiceMarkedByAdmin?.email ??
            null,
        },
        packStatus: p.status.code,
      };
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        // Suma de TODA la selección, no de la página.
        totals: {
          taxBase: totals._sum.taxBase ?? 0,
          taxAmount: totals._sum.taxAmount ?? 0,
          total: totals._sum.totalPaid ?? 0,
        },
      },
    };
  }

  /**
   * Marca una venta como facturada (o corrige el número). Guarda quién la marcó.
   * Rechaza las bolsas sin cobro: no existe factura para un valor de 0.
   */
  async markEinvoiceSent(
    packId: string,
    einvoiceNumber: string,
    callerUserId: string,
  ) {
    const pack = await this.prisma.analysisPack.findUnique({
      where: { id: packId },
      select: { id: true, totalPaid: true, paidAt: true },
    });
    if (!pack) {
      throw new NotFoundException(`Bolsa con id=${packId} no encontrada`);
    }
    if (pack.totalPaid <= 0) {
      throw new BadRequestException(
        'Esta bolsa se entregó sin costo: no hay factura que registrar',
      );
    }

    const admin =
      await this.platformAdminRepository.findByUserIdWithRole(callerUserId);

    return this.prisma.analysisPack.update({
      where: { id: packId },
      data: {
        einvoiceSent: true,
        einvoiceSentAt: new Date(),
        einvoiceNumber: einvoiceNumber.trim(),
        einvoiceMarkedBy: admin?.id ?? null,
      },
      select: {
        id: true,
        einvoiceSent: true,
        einvoiceSentAt: true,
        einvoiceNumber: true,
      },
    });
  }

  /**
   * Deshace la marca (se anuló la factura o se registró por error). Vuelve a la
   * cola de pendientes conservando el histórico solo en logs.
   */
  async unmarkEinvoiceSent(packId: string) {
    const pack = await this.prisma.analysisPack.findUnique({
      where: { id: packId },
      select: { id: true },
    });
    if (!pack) {
      throw new NotFoundException(`Bolsa con id=${packId} no encontrada`);
    }

    return this.prisma.analysisPack.update({
      where: { id: packId },
      data: {
        einvoiceSent: false,
        einvoiceSentAt: null,
        einvoiceNumber: null,
        einvoiceMarkedBy: null,
      },
      select: { id: true, einvoiceSent: true },
    });
  }

  /** Resuelve userIds de Supabase → PlatformAdmin (name/email) para display. */
  private async platformAdminsByUserId(userIds: string[]) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) {
      return new Map<
        string,
        { userId: string; name: string | null; email?: string }
      >();
    }
    const admins = await this.prisma.platformAdmin.findMany({
      where: { userId: { in: unique } },
      select: { userId: true, name: true, email: true },
    });
    return new Map(admins.map((a) => [a.userId, a]));
  }
}
