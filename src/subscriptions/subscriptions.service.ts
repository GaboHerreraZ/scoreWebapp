import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { EpaycoService } from '../epayco/epayco.service.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import { OnboardingSetupDto } from './dto/onboarding-setup.dto.js';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly prisma: PrismaService,
    private readonly consultationPricesService: ConsultationPricesService,
    private readonly epaycoService: EpaycoService,
  ) {}

  /**
   * Para un plan "estático": calcula el monto (estudios × precio de consulta
   * vigente) y crea el plan recurrente en ePayco. Devuelve el id_plan a guardar
   * en la subscription para reutilizarlo en cada cobro. El monto queda congelado
   * en ePayco; si el ConsultationPrice cambia luego, el plan debe recrearse
   * (parte del flujo de versionado de ConsultationPrice, fuera de este alcance).
   */
  /**
   * Crea un plan recurrente en ePayco para un plan de catálogo, con el monto
   * = maxStudiesPerMonth × unitPrice. Devuelve el id_plan a persistir. Recibe el
   * unitPrice explícito para que el resync use el precio nuevo sin reconsultarlo.
   */
  private async createEpaycoPlan(
    plan: {
      name: string;
      description?: string | null;
      maxStudiesPerMonth?: number | null;
      isMonthly?: boolean;
    },
    unitPrice: number,
  ): Promise<string> {
    const studies = plan.maxStudiesPerMonth ?? 0;
    if (studies <= 0) {
      throw new BadRequestException(
        'Un plan de ePayco requiere maxStudiesPerMonth mayor a 0 para calcular el monto a cobrar.',
      );
    }

    const amount = studies * unitPrice;
    // isMonthly por defecto es true (igual que la columna en BD).
    const interval = plan.isMonthly === false ? 'year' : 'month';
    // id_plan visible en el panel de ePayco: prefijo legible + sufijo único para
    // no colisionar con planes anteriores del mismo nombre.
    const idPlan = `plan_${this.slug(plan.name)}_${randomBytes(4).toString('hex')}`;

    return this.epaycoService.createPlan({
      idPlan,
      name: plan.name.slice(0, 90),
      description: (plan.description ?? plan.name).slice(0, 250),
      amount,
      interval,
    });
  }

  /** Precio de consulta vigente o error si no hay ninguno configurado. */
  private async requireActiveUnitPrice(): Promise<number> {
    const activePrice = await this.consultationPricesService.getActivePrice();
    if (!activePrice) {
      throw new BadRequestException(
        'No hay un precio de consulta activo configurado. Configure un ConsultationPrice antes de crear planes de ePayco.',
      );
    }
    return activePrice.unitPrice;
  }

  /** Normaliza un nombre a un slug seguro para el id_plan de ePayco. */
  private slug(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
  }

  /**
   * Aplana la relación createdByAdmin a un campo plano createdByEmail,
   * conservando createdBy (el id) y omitiendo el objeto anidado.
   */
  private withCreatedByEmail<
    T extends { createdByAdmin?: { email: string } | null },
  >(subscription: T) {
    const { createdByAdmin, ...rest } = subscription;
    return {
      ...rest,
      createdByEmail: createdByAdmin?.email ?? null,
    };
  }

  /**
   * Agrega el precio derivado del plan: maxStudiesPerMonth × unitPrice del
   * ConsultationPrice vigente. Para mostrar en el front sin recalcular.
   * - unitPrice: precio por consulta vigente (null si no hay precio activo).
   * - price: total del plan (0 si el plan no incluye consultas).
   */
  private withPrice<T extends { maxStudiesPerMonth?: number | null }>(
    subscription: T,
    unitPrice: number | null,
  ) {
    const studies = subscription.maxStudiesPerMonth ?? 0;
    return {
      ...subscription,
      unitPrice,
      price: unitPrice !== null ? studies * unitPrice : null,
    };
  }

  async create(dto: CreateSubscriptionDto, userId: string) {
    // El plan lo crea un admin del portal: resolvemos su PK desde el userId Supabase.
    const admin = await this.repository.findPlatformAdminByUserId(userId);

    // Plan estático: creamos el plan recurrente en ePayco ANTES de persistir, para
    // guardar su id_plan. Plan dinámico (isEpaycoPlan false/undefined): epaycoPlanId
    // queda null y el plan ePayco se crea por empresa en el onboarding.
    const epaycoPlanId = dto.isEpaycoPlan
      ? await this.createEpaycoPlan(dto, await this.requireActiveUnitPrice())
      : null;

    try {
      const subscription = await this.repository.create({
        name: dto.name,
        description: dto.description,
        isMonthly: dto.isMonthly,
        maxUsers: dto.maxUsers,
        maxCompanies: dto.maxCompanies,
        maxCustomers: dto.maxCustomers,
        maxStudiesPerMonth: dto.maxStudiesPerMonth,
        maxAiAnalysisPerMonth: dto.maxAiAnalysisPerMonth,
        maxPdfExtractionsPerMonth: dto.maxPdfExtractionsPerMonth,
        isActive: dto.isActive,
        epaycoPlanId,
        createdBy: admin?.id ?? null,
      });

      return this.withCreatedByEmail(subscription);
    } catch (error) {
      // El plan ya quedó creado en ePayco pero no en BD: queda huérfano allá. No
      // afecta cobros (nadie lo referencia); solo se registra para limpieza manual.
      if (epaycoPlanId) {
        this.logger.warn(
          `Subscription no se guardó en BD tras crear el plan ePayco "${epaycoPlanId}". El plan quedó huérfano en ePayco.`,
        );
      }
      throw error;
    }
  }

  /**
   * Recrea el catálogo de planes con un nuevo precio de consulta. Se invoca al
   * crear un ConsultationPrice que entra vigente. Por cada plan actual
   * (isCurrent=true) crea uno nuevo clonando sus límites pero con el monto
   * recalculado: los que eran ePayco generan un plan nuevo en ePayco con el
   * precio nuevo; los dinámicos se clonan solo en BD. Los planes viejos pasan a
   * isCurrent=false (siguen isActive y sin cancelar en ePayco, para no romper los
   * cobros recurrentes de las empresas que ya los usan).
   *
   * Best-effort: si crear un plan en ePayco falla, ese plan se omite y se sigue
   * con los demás; el precio nuevo ya quedó guardado por el llamador.
   */
  async resyncPlansForNewPrice(unitPrice: number, adminId: string | null) {
    const current = await this.repository.findCurrentActive();
    if (current.length === 0) {
      this.logger.log('Resync de planes: no hay planes vigentes que recrear.');
      return { recreated: 0, skipped: 0 };
    }

    const newPlans: Array<{
      name: string;
      description: string | null;
      isMonthly: boolean;
      maxUsers: number;
      maxCompanies: number;
      maxCustomers: number | null;
      maxStudiesPerMonth: number | null;
      maxAiAnalysisPerMonth: number | null;
      maxPdfExtractionsPerMonth: number | null;
      isActive: boolean;
      epaycoPlanId: string | null;
      createdBy: string | null;
    }> = [];
    const replacedIds: string[] = [];
    let skipped = 0;

    for (const plan of current) {
      let epaycoPlanId: string | null = null;
      // Solo recreamos en ePayco los planes que ya eran de ePayco (tenían id_plan).
      if (plan.epaycoPlanId) {
        try {
          epaycoPlanId = await this.createEpaycoPlan(plan, unitPrice);
        } catch (error) {
          this.logger.warn(
            `Resync: no se pudo recrear en ePayco el plan "${plan.name}" (${plan.id}); se omite. ${error?.message ?? error}`,
          );
          skipped++;
          continue;
        }
      }

      newPlans.push({
        name: plan.name,
        description: plan.description,
        isMonthly: plan.isMonthly,
        maxUsers: plan.maxUsers,
        maxCompanies: plan.maxCompanies,
        maxCustomers: plan.maxCustomers,
        maxStudiesPerMonth: plan.maxStudiesPerMonth,
        maxAiAnalysisPerMonth: plan.maxAiAnalysisPerMonth,
        maxPdfExtractionsPerMonth: plan.maxPdfExtractionsPerMonth,
        isActive: true,
        epaycoPlanId,
        createdBy: adminId,
      });
      replacedIds.push(plan.id);
    }

    if (newPlans.length === 0) {
      this.logger.warn(
        'Resync de planes: ningún plan pudo recrearse; el catálogo vigente queda sin cambios.',
      );
      return { recreated: 0, skipped };
    }

    await this.repository.replaceCurrentCatalog({
      oldPlanIds: replacedIds,
      newPlans,
    });

    this.logger.log(
      `Resync de planes: ${newPlans.length} plan(es) recreados con el nuevo precio (${skipped} omitidos).`,
    );
    return { recreated: newPlans.length, skipped };
  }

  /**
   * Lista planes. Por defecto solo el catálogo vigente (lo que consume el
   * onboarding). Con scope 'all' devuelve TODOS los planes —vigentes, legados y
   * desactivados— para la vista de administración del portal.
   */
  async findAll(scope?: 'all') {
    const [subscriptions, activePrice] = await Promise.all([
      scope === 'all'
        ? this.repository.findAllIncludingInactive()
        : this.repository.findAllActive(),
      this.consultationPricesService.getActivePrice(),
    ]);
    const unitPrice = activePrice?.unitPrice ?? null;

    return {
      data: subscriptions.map((s) =>
        this.withPrice(this.withCreatedByEmail(s), unitPrice),
      ),
    };
  }

  async findByName(name: string) {
    return this.repository.findByName(name);
  }

  async findById(id: string) {
    const subscription = await this.repository.findById(id);
    if (!subscription) {
      throw new NotFoundException(`Suscripción con id=${id} no encontrada`);
    }
    const activePrice = await this.consultationPricesService.getActivePrice();
    return this.withPrice(
      this.withCreatedByEmail(subscription),
      activePrice?.unitPrice ?? null,
    );
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Suscripción con id=${id} no encontrada`);
    }

    // El update solo aplica a planes dinámicos. Un plan estático tiene su monto
    // congelado en ePayco; editarlo (estudios, vigencia, etc.) lo desincronizaría
    // del plan ePayco. Esos planes se reemplazan al versionar el ConsultationPrice,
    // no se editan en sitio.
    if (current.epaycoPlanId) {
      throw new ConflictException(
        'Este plan está vinculado a un plan de ePayco y no puede editarse. Para cambiar su precio o límites, recree el plan al actualizar el precio de consulta.',
      );
    }

    const subscription = await this.repository.update(id, {
      name: dto.name,
      description: dto.description,
      isMonthly: dto.isMonthly,
      maxUsers: dto.maxUsers,
      maxCompanies: dto.maxCompanies,
      maxCustomers: dto.maxCustomers,
      maxStudiesPerMonth: dto.maxStudiesPerMonth,
      maxAiAnalysisPerMonth: dto.maxAiAnalysisPerMonth,
      maxPdfExtractionsPerMonth: dto.maxPdfExtractionsPerMonth,
      isActive: dto.isActive,
    });

    return this.withCreatedByEmail(subscription);
  }

  async remove(id: string) {
    const subscription = await this.repository.findById(id);
    if (!subscription) {
      throw new NotFoundException(`Suscripción con id=${id} no encontrada`);
    }

    const hasCompanies = await this.repository.hasCompanies(id);
    if (hasCompanies) {
      throw new ConflictException(
        'No se puede eliminar: alguna empresa tiene o tuvo esta suscripción (se conserva como histórico). Desactívela en su lugar.',
      );
    }

    return this.repository.delete(id);
  }

  async onboardingSetup(userId: string, dto: OnboardingSetupDto) {
    // Validate NIT uniqueness
    const existingCompany = await this.prisma.company.findUnique({
      where: { nit: dto.company.nit },
    });
    if (existingCompany) {
      throw new ConflictException(
        `Ya existe una empresa con el NIT "${dto.company.nit}"`,
      );
    }

    // Get administrator role
    const adminRole = await this.prisma.parameter.findUnique({
      where: {
        type_code: { type: 'user_company_role', code: 'administrator' },
      },
    });
    if (!adminRole) {
      throw new BadRequestException(
        'Parámetro de rol "administrator" no encontrado',
      );
    }

    // Run everything in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Upsert profile (may already exist from Supabase sign-up)
      const profile = await tx.profile.upsert({
        where: { id: userId },
        update: {
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          email: dto.profile.email,
          phone: dto.profile.phone,
          position: dto.profile.position,
          identificationTypeId: dto.profile.identificationTypeId,
          identificationNumber: dto.profile.identificationNumber,
          roleId: dto.profile.roleId,
        },
        create: {
          id: userId,
          email: dto.profile.email,
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          phone: dto.profile.phone,
          position: dto.profile.position,
          identificationTypeId: dto.profile.identificationTypeId,
          identificationNumber: dto.profile.identificationNumber,
          roleId: dto.profile.roleId,
        },
      });

      // 2. Create company
      const company = await tx.company.create({
        data: {
          name: dto.company.name,
          nit: dto.company.nit,
          sectorId: dto.company.sectorId,
          state: dto.company.state,
          city: dto.company.city,
          address: dto.company.address,
        },
      });

      // 3. Associate user to company as administrator
      const userCompany = await tx.userCompany.create({
        data: {
          userId,
          companyId: company.id,
          roleId: adminRole.id,
          joinedAt: new Date(),
        },
      });

      return { profile, company, userCompany };
    });

    return result;
  }
}
