import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository.js';
import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { FilterProfileDto } from './dto/filter-profile.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly repository: ProfilesRepository) {}

  async create(dto: CreateProfileDto) {
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(
        `Profile with email "${dto.email}" already exists`,
      );
    }

    return this.repository.create({
      id: dto.id,
      email: dto.email,
      name: dto.name,
      lastName: dto.lastName,
      phone: dto.phone,
      roleId: dto.roleId,
      position: dto.position,
    });
  }

  async findAll(filters: FilterProfileDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ProfileWhereInput = {};

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
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
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw new NotFoundException(`Profile with id=${id} not found`);
    }
    return profile;
  }

  async update(id: string, dto: UpdateProfileDto) {
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw new NotFoundException(`Profile with id=${id} not found`);
    }

    return this.repository.update(id, {
      name: dto.name,
      lastName: dto.lastName,
      phone: dto.phone,
      roleId: dto.roleId,
      position: dto.position,
      metadata: dto.metadata as Prisma.InputJsonValue,
    });
  }

  async remove(id: string) {
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw new NotFoundException(`Profile with id=${id} not found`);
    }

    const hasRelated = await this.repository.hasRelatedRecords(id);
    if (hasRelated) {
      throw new ConflictException(
        'Cannot delete: this profile has associated companies',
      );
    }

    return this.repository.delete(id);
  }

  async findCompanies(profileId: string, filters: PaginationDto) {
    const profile = await this.repository.findById(profileId);
    if (!profile) {
      throw new NotFoundException(`Profile with id=${profileId} not found`);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const { data, total } = await this.repository.findCompanies({
      userId: profileId,
      skip,
      take: limit,
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

  async findInvitedUsers(profileId: string, filters: PaginationDto) {
    const profile = await this.repository.findById(profileId);
    if (!profile) {
      throw new NotFoundException(`Profile with id=${profileId} not found`);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const { data, total } = await this.repository.findInvitedUsers({
      userId: profileId,
      skip,
      take: limit,
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
}
