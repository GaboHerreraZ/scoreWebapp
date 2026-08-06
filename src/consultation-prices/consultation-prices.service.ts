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
      // IVA vigente para este precio (default 19% incluido en el unitPrice).
      ...(dto.taxRate !== undefined && {
        taxRate: new Prisma.Decimal(dto.taxRate),
      }),
      ...(dto.taxIncluded !== undefined && { taxIncluded: dto.taxIncluded }),
      isActive: dto.isActive,
      createdBy: admin.id,
    });
  }

  async findAll(filters: FilterConsultationPriceDto) {
    const { page = 1, limit = 10, isActive } = filters;

    const where: Prisma.ConsultationPriceWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;

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
    const current = await this.findById(id);

    const admin = await this.repository.findPlatformAdminByUserId(userId);
    if (!admin) {
      throw new BadRequestException(
        'Solo un administrador del portal puede modificar precios de consulta',
      );
    }

    // Siempre debe quedar al menos un precio activo (si no, el catálogo de packs
    // no puede cotizar). No se permite desactivar el único registro activo:
    // primero créese/actívese otro precio.
    if (dto.isActive === false && current.isActive) {
      const activeCount = await this.repository.countActive();
      if (activeCount <= 1) {
        throw new ConflictException(
          'No se puede desactivar el único precio de consulta activo. ' +
            'Cree o active otro precio antes de desactivar este.',
        );
      }
    }

    // unitPrice es INMUTABLE: una bolsa comprada congela el precio y apunta a
    // este registro (consultationPriceId). Editar unitPrice rompería la
    // trazabilidad (la bolsa quedaría apuntando a un precio distinto al que
    // pagó). Para cambiar el precio, créese un registro nuevo (desactiva el
    // anterior). Solo se editan name, currencyCode e isActive.
    if (dto.unitPrice !== undefined) {
      throw new ConflictException(
        'No se puede editar el precio (unitPrice) de un registro existente. ' +
          'Cree un nuevo precio de consulta; el anterior se desactivará.',
      );
    }

    // El IVA es inmutable por la MISMA razón: las bolsas ya vendidas con este
    // precio congelaron su tarifa y apuntan aquí. Cuando cambie el IVA (o la
    // forma de cobrarlo), se crea un precio nuevo con la tarifa nueva; las
    // ventas anteriores conservan la que rigió y su factura sigue cuadrando.
    if (dto.taxRate !== undefined || dto.taxIncluded !== undefined) {
      throw new ConflictException(
        'No se puede editar el IVA (taxRate/taxIncluded) de un registro ' +
          'existente. Cree un nuevo precio de consulta con la tarifa vigente; ' +
          'el anterior se desactivará y las ventas ya emitidas conservan la suya.',
      );
    }

    return this.repository.update(id, {
      name: dto.name,
      currencyCode: dto.currencyCode,
      isActive: dto.isActive,
      updatedBy: admin.id,
    });
  }

  async remove(id: string) {
    await this.findById(id);

    // No se borra si alguna bolsa se compró con este precio (auditoría).
    const inUse = await this.repository.countAnalysisPacks(id);
    if (inUse > 0) {
      throw new ConflictException(
        'No se puede eliminar: hay bolsas compradas con este precio. Desactívelo en su lugar.',
      );
    }

    return this.repository.delete(id);
  }
}
