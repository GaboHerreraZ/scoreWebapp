import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConsultationPricesRepository } from './consultation-prices.repository.js';
import { CreateConsultationPriceDto } from './dto/create-consultation-price.dto.js';
import { UpdateConsultationPriceDto } from './dto/update-consultation-price.dto.js';
import { FilterConsultationPriceDto } from './dto/filter-consultation-price.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ConsultationPricesService {
  constructor(private readonly repository: ConsultationPricesRepository) {}

  /** Precio de consulta vigente (registro activo más reciente). */
  async getActivePrice() {
    return this.repository.findActive();
  }

  async create(dto: CreateConsultationPriceDto, userId: string) {
    // El precio lo registra un admin del portal: resolvemos su PK desde Supabase.
    const admin = await this.repository.findPlatformAdminByUserId(userId);
    if (!admin) {
      throw new BadRequestException(
        'Solo un administrador del portal puede registrar precios de consulta',
      );
    }

    return this.repository.create({
      name: dto.name,
      unitPrice: dto.unitPrice,
      currencyCode: dto.currencyCode,
      hasDiscount: dto.hasDiscount,
      basePrice: dto.basePrice,
      discountTypeId: dto.discountTypeId,
      discountValue: dto.discountValue,
      validFrom: new Date(dto.validFrom),
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      isActive: dto.isActive,
      createdBy: admin.id,
    });
  }

  async findAll(filters: FilterConsultationPriceDto) {
    const { page = 1, limit = 10, isActive, hasDiscount } = filters;

    const where: Prisma.ConsultationPriceWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (hasDiscount !== undefined) where.hasDiscount = hasDiscount;

    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string) {
    const price = await this.repository.findById(id);
    if (!price) {
      throw new NotFoundException(
        `Precio de consulta con id=${id} no encontrado`,
      );
    }
    return price;
  }

  async update(id: string, dto: UpdateConsultationPriceDto, userId: string) {
    await this.findById(id);

    const admin = await this.repository.findPlatformAdminByUserId(userId);
    if (!admin) {
      throw new BadRequestException(
        'Solo un administrador del portal puede modificar precios de consulta',
      );
    }

    return this.repository.update(id, {
      name: dto.name,
      unitPrice: dto.unitPrice,
      currencyCode: dto.currencyCode,
      hasDiscount: dto.hasDiscount,
      basePrice: dto.basePrice,
      discountTypeId: dto.discountTypeId,
      discountValue: dto.discountValue,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
      validUntil:
        dto.validUntil === undefined ? undefined : new Date(dto.validUntil),
      isActive: dto.isActive,
      updatedBy: admin.id,
    });
  }

  async remove(id: string) {
    await this.findById(id);

    // No se borra si alguna suscripción se calculó con este precio (auditoría).
    const inUse = await this.repository.countCompanySubscriptions(id);
    if (inUse > 0) {
      throw new ConflictException(
        'No se puede eliminar: hay suscripciones calculadas con este precio. Desactívelo en su lugar.',
      );
    }

    return this.repository.delete(id);
  }
}
