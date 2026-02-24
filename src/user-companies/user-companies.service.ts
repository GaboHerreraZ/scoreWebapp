import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { UserCompaniesRepository } from './user-companies.repository.js';
import { CreateUserCompanyDto } from './dto/create-user-company.dto.js';
import { UpdateUserCompanyDto } from './dto/update-user-company.dto.js';
import { FilterUserCompanyDto } from './dto/filter-user-company.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class UserCompaniesService {
  constructor(private readonly repository: UserCompaniesRepository) {}

  async create(
    companyId: string,
    invitedBy: string,
    dto: CreateUserCompanyDto,
  ) {
    const profileExists = await this.repository.profileExists(dto.userId);
    if (!profileExists) {
      throw new NotFoundException(
        `Profile with id=${dto.userId} not found`,
      );
    }

    const companyExists = await this.repository.companyExists(companyId);
    if (!companyExists) {
      throw new NotFoundException(
        `Company with id=${companyId} not found`,
      );
    }

    const roleExists = await this.repository.parameterExists(dto.roleId);
    if (!roleExists) {
      throw new NotFoundException(
        `Role parameter with id=${dto.roleId} not found`,
      );
    }

    const existing = await this.repository.findByUserAndCompany(
      dto.userId,
      companyId,
    );
    if (existing) {
      throw new ConflictException(
        'This user is already associated with this company',
      );
    }

    return this.repository.create({
      userId: dto.userId,
      companyId,
      roleId: dto.roleId,
      invitedBy,
      joinedAt: new Date(),
    });
  }

  async findAll(companyId: string, filters: FilterUserCompanyDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.UserCompanyWhereInput = { companyId };

    if (filters.roleId !== undefined) {
      where.roleId = filters.roleId;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.user = {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { lastName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ],
      };
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

  async findById(id: string, companyId: string) {
    const userCompany = await this.repository.findById(id, companyId);
    if (!userCompany) {
      throw new NotFoundException(
        `User-company relation with id=${id} not found in this company`,
      );
    }
    return userCompany;
  }

  async update(id: string, companyId: string, dto: UpdateUserCompanyDto) {
    const current = await this.repository.findById(id, companyId);
    if (!current) {
      throw new NotFoundException(
        `User-company relation with id=${id} not found in this company`,
      );
    }

    if (dto.roleId !== undefined) {
      const roleExists = await this.repository.parameterExists(dto.roleId);
      if (!roleExists) {
        throw new NotFoundException(
          `Role parameter with id=${dto.roleId} not found`,
        );
      }
    }

    return this.repository.update(id, {
      roleId: dto.roleId,
      isActive: dto.isActive,
    });
  }

  async remove(id: string, companyId: string) {
    const userCompany = await this.repository.findById(id, companyId);
    if (!userCompany) {
      throw new NotFoundException(
        `User-company relation with id=${id} not found in this company`,
      );
    }

    return this.repository.delete(id);
  }
}
