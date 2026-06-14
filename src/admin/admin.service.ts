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
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { OnboardClientDto } from './dto/onboard-client.dto.js';
import { ChangeTierDto } from './dto/change-tier.dto.js';
import { getCurrentCycleWindow } from '../common/utils/subscription-cycle.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly mailService: MailService,
    private readonly consultationPricesService: ConsultationPricesService,
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
  async onboardClient(dto: OnboardClientDto, _adminUserId: string) {
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

    // Precio por consulta vigente: el pricePaid se calcula como
    // studiesPerMonth × unitPrice, y guardamos el id del precio usado.
    const consultationPrice =
      await this.consultationPricesService.getActivePrice();
    if (!consultationPrice) {
      throw new BadRequestException(
        'No hay un precio de consulta activo configurado. Configure un ConsultationPrice antes de dar de alta clientes.',
      );
    }
    const pricePaid =
      dto.subscription.studiesPerMonth * consultationPrice.unitPrice;

    const existingProfile = await this.prisma.profile.findFirst({
      where: { email: dto.owner.email },
    });

    const [pendingPaymentStatus, pendingInvStatus, adminRole] =
      await Promise.all([
        this.getParam('subscription_status', 'pending_payment'),
        this.getParam('invitation_status', 'pending'),
        this.getParam('user_company_role', 'administrator'),
      ]);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Secreto del link de pago (independiente del token de invitación).
    const paymentToken = randomBytes(32).toString('hex');

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

      // 2. Suscripción (plan elegido + nivel configurado).
      // Nace en pending_payment: se activa cuando el cliente paga (checkout propio).
      const subscription = await tx.companySubscription.create({
        data: {
          companyId: company.id,
          subscriptionId,
          statusId: pendingPaymentStatus.id,
          startDate: new Date(dto.subscription.startDate),
          endDate: new Date(dto.subscription.endDate),
          isCurrent: true,
          autoRenew: false,
          paymentFrequency: plan.isMonthly ? 'monthly' : 'annual',
          pricePaid,
          consultationPriceId: consultationPrice.id,
          paymentToken,
          maxStudiesPerMonthOverride: dto.subscription.studiesPerMonth,
          maxUsersOverride: dto.subscription.maxUsers,
          maxCustomersOverride: dto.subscription.maxCustomers,
          maxAiAnalysisPerMonthOverride: dto.subscription.maxAiAnalysisPerMonth,
          maxPdfExtractionsPerMonthOverride:
            dto.subscription.maxPdfExtractionsPerMonth,
          contractId: newContractId,
        },
      });

      // 3. Invitación del dueño de la empresa (rol administrator).
      // invitedBy = null: quien invita es el equipo Creditia (platform_admin),
      // que no es un Profile de empresa, así que no puede referenciarse aquí.
      const invitation = await tx.invitation.create({
        data: {
          email: dto.owner.email,
          companyId: company.id,
          roleId: adminRole.id,
          statusId: pendingInvStatus.id,
          token,
          expiresAt,
          invitedBy: null,
          type: 'account_onboarding',
        },
      });

      // Si ya existe un perfil con ese email, crear UserCompany inactivo
      if (existingProfile) {
        await tx.userCompany.create({
          data: {
            userId: existingProfile.id,
            companyId: company.id,
            roleId: adminRole.id,
            invitedBy: null,
            isActive: false,
          },
        });
      }

      return { company, subscription, invitation };
    });

    // Envío de email de bienvenida al owner fuera de la transacción (best effort).
    // Incluye el link de pago (companySubscriptionId + paymentToken) y los datos
    // del plan para que el correo muestre qué se contrata y cuánto se paga.
    this.mailService
      .sendOwnerWelcomeEmail({
        to: dto.owner.email,
        invitationId: result.invitation.id,
        token,
        companyName: result.company.name,
        companySubscriptionId: result.subscription.id,
        paymentToken,
        planName: plan.name,
        studiesPerMonth: dto.subscription.studiesPerMonth,
        maxUsers: dto.subscription.maxUsers,
        amount: pricePaid,
        isMonthly: plan.isMonthly,
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

    // El nuevo nivel cambia el precio: recalculamos con el precio vigente.
    const consultationPrice =
      await this.consultationPricesService.getActivePrice();
    if (!consultationPrice) {
      throw new BadRequestException(
        'No hay un precio de consulta activo configurado. Configure un ConsultationPrice antes de cambiar el nivel.',
      );
    }
    const pricePaid = dto.studiesPerMonth * consultationPrice.unitPrice;

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
          paymentFrequency: current.paymentFrequency,
          pricePaid,
          consultationPriceId: consultationPrice.id,
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

  /** Listado cross-tenant de empresas con su nivel vigente y vigencia. */
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
      const sub = c.companySubscriptions.find((s) => s.isCurrent);
      return {
        id: c.id,
        name: c.name,
        nit: c.nit,
        isActive: c.isActive,
        subscription: sub
          ? {
              id: sub.id,
              plan: sub.subscription?.name,
              studiesPerMonth: sub.maxStudiesPerMonthOverride ?? 0,
              maxUsers: sub.maxUsersOverride ?? 0,
              maxAiAnalysisPerMonth: sub.maxAiAnalysisPerMonthOverride ?? 0,
              maxPdfExtractionsPerMonth:
                sub.maxPdfExtractionsPerMonthOverride ?? 0,
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
          include: { role: true, user: true },
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
        maxUsers: s.maxUsersOverride,
        maxCustomers: s.maxCustomersOverride,
        maxAiAnalysisPerMonth: s.maxAiAnalysisPerMonthOverride,
        maxPdfExtractionsPerMonth: s.maxPdfExtractionsPerMonthOverride,
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
        invitedBy: uc.invitedBy,
        joinedAt: uc.joinedAt,
        name: uc.user.name,
        email: uc.user.email
      })),
    };
  }

  /**
   * Consumo del ciclo actual por recurso: estudios, análisis de IA, extracciones
   * de PDF (todos relativos al ciclo mensual vigente) y customers (límite total
   * acumulado, no por ciclo). Cada recurso reporta used/max/remaining; max=null
   * significa ilimitado (remaining queda en null).
   */
  async getUsage(companyId: string) {
    const current = await this.prisma.companySubscription.findFirst({
      where: { companyId, isCurrent: true },
      include: { subscription: true },
    });
    if (!current) {
      throw new NotFoundException(
        'La empresa no tiene una suscripción vigente.',
      );
    }

    // Límites efectivos: override del tramo vigente o, si no hay, el del plan.
    const maxStudies =
      current.maxStudiesPerMonthOverride ??
      current.subscription.maxStudiesPerMonth;
    const maxAiAnalysis =
      current.maxAiAnalysisPerMonthOverride ??
      current.subscription.maxAiAnalysisPerMonth;
    const maxPdfExtractions =
      current.maxPdfExtractionsPerMonthOverride ??
      current.subscription.maxPdfExtractionsPerMonth;
    const maxCustomers =
      current.maxCustomersOverride ?? current.subscription.maxCustomers;

    const { cycleStart, cycleEnd } = getCurrentCycleWindow(current.startDate);

    // Tipos de AiAnalysis para contar análisis vs extracciones por separado.
    const [analysisType, extractionType] = await Promise.all([
      this.parametersRepository.findByCode('creditReview'),
      this.parametersRepository.findByCode('financialStatementsPdfUpload'),
    ]);

    // Tipos de AiAnalysis a contar (los que existan como parámetro).
    const aiTypeIds = [analysisType?.id, extractionType?.id].filter(
      (id): id is number => id != null,
    );

    const [studiesUsed, aiByType, customersTotal] = await Promise.all([
      this.prisma.creditStudy.count({
        where: { companyId, createdAt: { gte: cycleStart, lt: cycleEnd } },
      }),
      // Una sola query agrupada cuenta análisis y extracciones por typeId; el
      // conteo lo hace la BD (devuelve una fila por tipo, no las filas crudas).
      aiTypeIds.length > 0
        ? this.prisma.aiAnalysis.groupBy({
            by: ['typeId'],
            where: {
              companyId,
              typeId: { in: aiTypeIds },
              createdAt: { gte: cycleStart, lt: cycleEnd },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      this.prisma.customer.count({ where: { companyId } }),
    ]);

    const usageByType = new Map(
      aiByType.map((row) => [row.typeId, row._count._all]),
    );
    const aiAnalysisUsed = analysisType
      ? (usageByType.get(analysisType.id) ?? 0)
      : 0;
    const pdfExtractionUsed = extractionType
      ? (usageByType.get(extractionType.id) ?? 0)
      : 0;

    const cycleResource = (used: number, max: number | null) => ({
      usedThisCycle: used,
      maxPerMonth: max,
      remaining: max != null ? Math.max(0, max - used) : null,
    });

    return {
      cycleStart,
      cycleEnd,
      studies: cycleResource(studiesUsed, maxStudies),
      aiAnalysis: cycleResource(aiAnalysisUsed, maxAiAnalysis),
      pdfExtraction: cycleResource(pdfExtractionUsed, maxPdfExtractions),
      customers: {
        total: customersTotal,
        max: maxCustomers,
        remaining:
          maxCustomers != null
            ? Math.max(0, maxCustomers - customersTotal)
            : null,
      },
    };
  }

  /**
   * Actividad del ciclo vigente para el equipo de soporte: lista (no conteo) de
   * lo creado en el ciclo actual — estudios, análisis de IA, extracciones de PDF
   * y customers — con solo los campos relevantes (quién, cuándo, customer). NO
   * devuelve el detalle completo de cada registro.
   */
  async getCycleActivity(companyId: string) {
    const current = await this.prisma.companySubscription.findFirst({
      where: { companyId, isCurrent: true },
      include: { subscription: true },
    });
    if (!current) {
      throw new NotFoundException(
        'La empresa no tiene una suscripción vigente.',
      );
    }

    const { cycleStart, cycleEnd } = getCurrentCycleWindow(current.startDate);
    const inCycle = { gte: cycleStart, lt: cycleEnd };

    const [analysisType, extractionType] = await Promise.all([
      this.parametersRepository.findByCode('creditReview'),
      this.parametersRepository.findByCode('financialStatementsPdfUpload'),
    ]);

    // Selección compacta del autor (Profile) reutilizada en cada recurso.
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
        where: { companyId, createdAt: inCycle },
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
          createdAt: inCycle,
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

    // Nombre legible de un Profile (autor) o null si no viene.
    const fullName = (
      user: { name: string | null; lastName: string | null } | null,
    ) => (user ? `${user.name ?? ''} ${user.lastName ?? ''}`.trim() || null : null);

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

    // Separar IA vs extracción de PDF (ambas viven en ai_analyses, distinguidas
    // por el tipo) para que soporte las vea en bloques distintos.
    const aiAnalysis = analysisType
      ? aiAnalyses.filter((a) => a.type.id === analysisType.id).map(mapAnalysis)
      : [];
    const pdfExtraction = extractionType
      ? aiAnalyses.filter((a) => a.type.id === extractionType.id).map(mapAnalysis)
      : [];

    // customers trae el total de la empresa; los del ciclo se derivan filtrando
    // por createdAt dentro de la ventana (sin una query extra).
    const customersThisCycle = customers.filter(
      (c) => c.createdAt >= cycleStart && c.createdAt < cycleEnd,
    );

    return {
      cycleStart,
      cycleEnd,
      studies: studies.map(mapStudy),
      aiAnalysis,
      pdfExtraction,
      customers: {
        total: customers.map(mapCustomer),
        createdThisCycle: customersThisCycle.map(mapCustomer),
      },
    };
  }

}
