import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { FilterNotificationDto } from './dto/filter-notification.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  async create(userId: string, dto: CreateNotificationDto) {
    return this.repository.create({
      companyId: dto.companyId,
      createdBy: userId,
      typeId: dto.typeId,
      title: dto.title,
      message: dto.message,
      route: dto.route,
    });
  }

  async findAll(
    companyId: string,
    userId: string,
    filters: FilterNotificationDto,
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = { companyId };

    if (filters.typeId) {
      where.typeId = filters.typeId;
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { message: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
      userId,
    });

    const mapped = data.map(({ reads, ...rest }) => ({
      ...rest,
      read: reads.length > 0,
    }));

    return {
      data: mapped,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async markAsRead(id: string, companyId: string, userId: string) {
    const notification = await this.repository.findById(id, companyId);
    if (!notification) {
      throw new NotFoundException(
        `Notification with id=${id} not found in this company`,
      );
    }

    return this.repository.markAsRead(id, userId);
  }

  async markAllAsRead(companyId: string, userId: string) {
    return this.repository.markAllAsRead(companyId, userId);
  }

  async getUnreadCount(companyId: string, userId: string) {
    const count = await this.repository.countUnread(companyId, userId);
    return { unreadCount: count };
  }

  async remove(id: string, companyId: string) {
    const notification = await this.repository.findById(id, companyId);
    if (!notification) {
      throw new NotFoundException(
        `Notification with id=${id} not found in this company`,
      );
    }

    return this.repository.delete(id);
  }
}
