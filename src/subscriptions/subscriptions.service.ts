import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import { OnboardingSetupDto } from './dto/onboarding-setup.dto.js';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly prisma: PrismaService,
    private readonly consultationPricesService: ConsultationPricesService,
  ) {}

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
      createdBy: admin?.id ?? null,
    });

    return this.withCreatedByEmail(subscription);
  }

  async findAll() {
    const [subscriptions, activePrice] = await Promise.all([
      this.repository.findAllActive(),
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
        'No se puede eliminar: esta suscripción tiene empresas asociadas',
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
