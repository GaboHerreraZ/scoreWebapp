import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CampaignsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.CampaignUncheckedCreateInput) {
    return this.prisma.campaign.create({ data });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.CampaignWhereInput;
    orderBy?: Prisma.CampaignOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.campaign.findMany({ skip, take, where, orderBy }),
      this.prisma.campaign.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string) {
    return this.prisma.campaign.findUnique({ where: { id } });
  }

  async update(id: string, data: Prisma.CampaignUncheckedUpdateInput) {
    return this.prisma.campaign.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.campaign.delete({ where: { id } });
  }

  async findActiveCampaign() {
    const today = new Date();
    return this.prisma.campaign.findFirst({
      where: {
        isActive: true,
        startDate: { lte: today },
        endDate: { gte: today },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
