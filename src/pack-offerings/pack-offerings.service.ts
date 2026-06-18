import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PackOfferingsRepository } from './pack-offerings.repository.js';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { CreatePackOfferingDto } from './dto/create-pack-offering.dto.js';
import { UpdatePackOfferingDto } from './dto/update-pack-offering.dto.js';
import { FilterPackOfferingDto } from './dto/filter-pack-offering.dto.js';
import {
  calculatePackPrice,
  type DiscountTypeCode,
} from '../common/utils/pack-pricing.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PackOfferingsService {
  constructor(
    private readonly repository: PackOfferingsRepository,
    private readonly consultationPricesService: ConsultationPricesService,
  ) {}

  async create(dto: CreatePackOfferingDto, userId: string) {
    const admin = await this.repository.findPlatformAdminByUserId(userId);
    if (!admin) {
      throw new BadRequestException(
        'Solo un administrador del portal puede crear ofertas de bolsas',
      );
    }

    return this.repository.create({
      name: dto.name,
      description: dto.description,
      quantity: dto.quantity,
      validityDays: dto.validityDays,
      hasDiscount: dto.hasDiscount,
      discountTypeId: dto.discountTypeId,
      discountValue: dto.discountValue,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
      isCurrent: dto.isCurrent,
      createdBy: admin.id,
    });
  }

  async findAll(filters: FilterPackOfferingDto) {
    const { page = 1, limit = 10, isActive, isCurrent } = filters;

    const where: Prisma.PackOfferingWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (isCurrent !== undefined) where.isCurrent = isCurrent;

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
    const offering = await this.repository.findById(id);
    if (!offering) {
      throw new NotFoundException(`Oferta de bolsa con id=${id} no encontrada`);
    }
    return offering;
  }

  async update(id: string, dto: UpdatePackOfferingDto, userId: string) {
    await this.findById(id);

    const admin = await this.repository.findPlatformAdminByUserId(userId);
    if (!admin) {
      throw new BadRequestException(
        'Solo un administrador del portal puede modificar ofertas de bolsas',
      );
    }

    return this.repository.update(id, {
      name: dto.name,
      description: dto.description,
      quantity: dto.quantity,
      validityDays: dto.validityDays,
      hasDiscount: dto.hasDiscount,
      discountTypeId: dto.discountTypeId,
      discountValue: dto.discountValue,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
      isCurrent: dto.isCurrent,
    });
  }

  async remove(id: string) {
    await this.findById(id);

    // No se borra si ya hay bolsas compradas con esta oferta (auditoría).
    const inUse = await this.repository.countAnalysisPacks(id);
    if (inUse > 0) {
      throw new ConflictException(
        'No se puede eliminar: hay bolsas compradas con esta oferta. Desactívela en su lugar.',
      );
    }

    return this.repository.delete(id);
  }

  /**
   * Catálogo que ve el cliente: ofertas vigentes con el precio YA RESUELTO
   * (derivado del ConsultationPrice vigente − descuento por volumen). El front
   * solo pinta; nunca calcula precio. Si no hay precio de consulta activo,
   * devuelve el catálogo con precios en null (no se puede cotizar aún).
   */
  async getCatalog() {
    const [offerings, activePrice] = await Promise.all([
      this.repository.findOfferable(),
      this.consultationPricesService.getActivePrice(),
    ]);

    return offerings.map((offering) => {
      const pricing = activePrice
        ? calculatePackPrice({
            quantity: offering.quantity,
            unitPrice: activePrice.unitPrice,
            hasDiscount: offering.hasDiscount,
            discountTypeCode: offering.discountType?.code as
              | DiscountTypeCode
              | undefined,
            discountValue: offering.discountValue,
          })
        : null;

      return {
        id: offering.id,
        name: offering.name,
        description: offering.description,
        quantity: offering.quantity,
        validityDays: offering.validityDays,
        sortOrder: offering.sortOrder,
        currency: activePrice?.currencyCode ?? 'COP',
        unitPrice: pricing?.unitPrice ?? null,
        subtotal: pricing?.subtotal ?? null,
        discountAmount: pricing?.discountAmount ?? null,
        total: pricing?.total ?? null,
      };
    });
  }
}
