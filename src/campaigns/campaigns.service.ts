import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CampaignsRepository } from './campaigns.repository.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';
import { UpdateCampaignDto } from './dto/update-campaign.dto.js';
import { FilterCampaignDto } from './dto/filter-campaign.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CampaignsService {
  constructor(private readonly repository: CampaignsRepository) {}

  async create(dto: CreateCampaignDto) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('endDate must be after startDate');
    }

    return this.repository.create({
      name: dto.name,
      description: dto.description,
      discount: dto.discount,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      isActive: dto.isActive,
    });
  }

  async findAll(filters: FilterCampaignDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CampaignWhereInput = {};

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    const campaign = await this.repository.findById(id);
    if (!campaign) {
      throw new NotFoundException(`Campaign with id=${id} not found`);
    }
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Campaign with id=${id} not found`);
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : current.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : current.endDate;

    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    return this.repository.update(id, {
      name: dto.name,
      description: dto.description,
      discount: dto.discount,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      isActive: dto.isActive,
    });
  }

  async remove(id: string) {
    const campaign = await this.repository.findById(id);
    if (!campaign) {
      throw new NotFoundException(`Campaign with id=${id} not found`);
    }
    return this.repository.delete(id);
  }

  async findActiveCampaign() {
    return this.repository.findActiveCampaign();
  }
}
