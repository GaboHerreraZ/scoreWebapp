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
      dashboardLevelId: dto.dashboardLevelId,
      excelReports: dto.excelReports,
      emailNotifications: dto.emailNotifications,
      themeCustomization: dto.themeCustomization,
      supportLevelId: dto.supportLevelId,
      isActive: dto.isActive,
    });
  }

  async findAll() {
    return this.repository.findAllActive();
  }

  async findById(id: string) {
    const subscription = await this.repository.findById(id);
    if (!subscription) {
      throw new NotFoundException(`Subscription with id=${id} not found`);
    }
    return subscription;
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Subscription with id=${id} not found`);
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
      dashboardLevelId: dto.dashboardLevelId,
      excelReports: dto.excelReports,
      emailNotifications: dto.emailNotifications,
      themeCustomization: dto.themeCustomization,
      supportLevelId: dto.supportLevelId,
      isActive: dto.isActive,
    });
  }

  async remove(id: string) {
    const subscription = await this.repository.findById(id);
    if (!subscription) {
      throw new NotFoundException(`Subscription with id=${id} not found`);
    }

    const hasCompanies = await this.repository.hasCompanies(id);
    if (hasCompanies) {
      throw new ConflictException(
        'Cannot delete: this subscription has associated companies',
      );
    }

    return this.repository.delete(id);
  }
}
