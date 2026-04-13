import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.NotificationUncheckedCreateInput) {
    return this.prisma.notification.create({
      data,
      include: {
        type: { select: { id: true, label: true, code: true } },
        createdByUser: { select: { id: true, name: true, lastName: true } },
      },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.NotificationWhereInput;
    orderBy?: Prisma.NotificationOrderByWithRelationInput;
    userId: string;
  }) {
    const { skip, take, where, orderBy, userId } = params;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        skip,
        take,
        where,
        orderBy,
        select: {
          id: true,
          title: true,
          message: true,
          route: true,
          createdAt: true,
          type: { select: { id: true, label: true, code: true } },
          createdByUser: { select: { id: true, name: true, lastName: true } },
          reads: {
            where: { userId },
            select: { id: true },
          },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.notification.findFirst({
      where: { id, companyId },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notificationRead.upsert({
      where: {
        notificationId_userId: { notificationId, userId },
      },
      create: { notificationId, userId },
      update: {},
    });
  }

  async markAllAsRead(companyId: string, userId: string) {
    const unreadNotifications = await this.prisma.notification.findMany({
      where: {
        companyId,
        reads: { none: { userId } },
      },
      select: { id: true },
    });

    if (unreadNotifications.length === 0) return { count: 0 };

    const result = await this.prisma.notificationRead.createMany({
      data: unreadNotifications.map((n) => ({
        notificationId: n.id,
        userId,
      })),
      skipDuplicates: true,
    });

    return { count: result.count };
  }

  async countUnread(companyId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        companyId,
        reads: { none: { userId } },
      },
    });
  }

  async delete(id: string) {
    await this.prisma.notificationRead.deleteMany({ where: { notificationId: id } });
    return this.prisma.notification.delete({ where: { id } });
  }
}
