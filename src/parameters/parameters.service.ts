import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ParametersRepository } from './parameters.repository.js';
import { CreateParameterDto } from './dto/create-parameter.dto.js';
import { UpdateParameterDto } from './dto/update-parameter.dto.js';
import { FilterParameterDto } from './dto/filter-parameter.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ParametersService {
  constructor(private readonly repository: ParametersRepository) {}

  async create(dto: CreateParameterDto) {
    const existing = await this.repository.findByTypeAndCode(
      dto.type,
      dto.code,
    );
    if (existing) {
      throw new ConflictException(
        `Ya existe un parámetro con type="${dto.type}" y code="${dto.code}"`,
      );
    }

    if (dto.parentId) {
      await this.ensureExists(dto.parentId);
    }

    return this.repository.create({
      type: dto.type,
      code: dto.code,
      label: dto.label,
      description: dto.description,
      isActive: dto.isActive,
      sortOrder: dto.sortOrder,
      parent: dto.parentId ? { connect: { id: dto.parentId } } : undefined,
    });
  }

  async findAll(filters: FilterParameterDto) {
    const where: Prisma.ParameterWhereInput = {};

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const { data, total } = await this.repository.findAll({
      where,
      orderBy: { sortOrder: 'asc' },
    });

    return {
      data,
      meta: {
        total,
      },
    };
  }

  async findById(id: number) {
    const parameter = await this.repository.findById(id);
    if (!parameter) {
      throw new NotFoundException(`Parámetro con id=${id} no encontrado`);
    }
    return parameter;
  }

  async update(id: number, dto: UpdateParameterDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Parámetro con id=${id} no encontrado`);
    }

    const newType = dto.type ?? current.type;
    const newCode = dto.code ?? current.code;

    if (dto.type || dto.code) {
      const duplicate = await this.repository.findByTypeAndCode(
        newType,
        newCode,
      );
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(
          `Ya existe un parámetro con type="${newType}" y code="${newCode}"`,
        );
      }
    }

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException(
          'Un parámetro no puede ser su propio padre',
        );
      }
      await this.ensureExists(dto.parentId);
    }

    return this.repository.update(id, {
      type: dto.type,
      code: dto.code,
      label: dto.label,
      description: dto.description,
      isActive: dto.isActive,
      sortOrder: dto.sortOrder,
      parent:
        dto.parentId !== undefined
          ? dto.parentId
            ? { connect: { id: dto.parentId } }
            : { disconnect: true }
          : undefined,
    });
  }

  async remove(id: number) {
    const parameter = await this.repository.findById(id);
    if (!parameter) {
      throw new NotFoundException(`Parámetro con id=${id} no encontrado`);
    }

    const hasChildren = await this.repository.hasChildren(id);
    if (hasChildren) {
      throw new ConflictException(
        'No se puede eliminar: este parámetro tiene parámetros hijos asociados',
      );
    }

    const isReferenced = await this.repository.isReferencedByOtherTables(id);
    if (isReferenced) {
      throw new ConflictException(
        'No se puede eliminar: este parámetro está referenciado por otros registros',
      );
    }

    return this.repository.delete(id);
  }

  private async ensureExists(id: number) {
    const parameter = await this.repository.findById(id);
    if (!parameter) {
      throw new NotFoundException(`Parámetro padre con id=${id} no encontrado`);
    }
  }
}
