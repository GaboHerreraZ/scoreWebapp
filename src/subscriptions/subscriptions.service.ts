import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async create(dto: CreateSubscriptionDto) {
    return this.repository.create({
      name: dto.name,
      description: dto.description,
      price: dto.price,
      isMonthly: dto.isMonthly,
      maxUsers: dto.maxUsers,
      maxCompanies: dto.maxCompanies,
      maxCustomers: dto.maxCustomers,
      maxStudiesPerMonth: dto.maxStudiesPerMonth,
      maxAiAnalysisPerMonth: dto.maxAiAnalysisPerMonth,
      dashboardLevelId: dto.dashboardLevelId,
      excelReports: dto.excelReports,
      emailNotifications: dto.emailNotifications,
      themeCustomization: dto.themeCustomization,
      supportLevelId: dto.supportLevelId,
      epaycoPlanId: dto.epaycoPlanId,
      isActive: dto.isActive,
    });
  }

  async findAll() {
    const subscriptions = await this.repository.findAllActive();

    return {
      data: subscriptions,
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
    return subscription;
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Suscripción con id=${id} no encontrada`);
    }

    return this.repository.update(id, {
      name: dto.name,
      description: dto.description,
      price: dto.price,
      isMonthly: dto.isMonthly,
      maxUsers: dto.maxUsers,
      maxCompanies: dto.maxCompanies,
      maxCustomers: dto.maxCustomers,
      maxStudiesPerMonth: dto.maxStudiesPerMonth,
      maxAiAnalysisPerMonth: dto.maxAiAnalysisPerMonth,
      dashboardLevelId: dto.dashboardLevelId,
      excelReports: dto.excelReports,
      emailNotifications: dto.emailNotifications,
      themeCustomization: dto.themeCustomization,
      supportLevelId: dto.supportLevelId,
      epaycoPlanId: dto.epaycoPlanId,
      isActive: dto.isActive,
    });
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
}
