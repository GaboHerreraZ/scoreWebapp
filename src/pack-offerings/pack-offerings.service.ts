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
  calculateTax,
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

    const productType = await this.repository.findProductType(
      dto.productTypeCode ?? 'creditStudy',
    );
    if (!productType) {
      throw new BadRequestException(
        `Producto de bolsa desconocido: ${dto.productTypeCode}`,
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
      productTypeId: productType.id,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
      createdBy: admin.id,
    });
  }

  /** Precios vigentes de ambos productos, para cotizar listas mixtas. */
  private async getActivePrices() {
    const [creditStudy, bureauCheck] = await Promise.all([
      this.consultationPricesService.getActivePrice('creditStudy'),
      this.consultationPricesService.getActivePrice('bureauCheck'),
    ]);
    return { creditStudy, bureauCheck };
  }

  private priceFor(
    prices: Awaited<ReturnType<PackOfferingsService['getActivePrices']>>,
    productCode: string | undefined,
  ) {
    return productCode === 'bureauCheck'
      ? prices.bureauCheck
      : prices.creditStudy;
  }

  async findAll(filters: FilterPackOfferingDto) {
    const { page = 1, limit = 10, isActive } = filters;

    const where: Prisma.PackOfferingWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;

    const [{ data, total }, prices] = await Promise.all([
      this.repository.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where,
      }),
      this.getActivePrices(),
    ]);

    // Cada oferta lleva la config cruda + el precio YA RESUELTO contra el
    // ConsultationPrice vigente DE SU PRODUCTO. Si ese producto no tiene precio
    // activo, los campos de pricing van en null (no cotizable).
    const dataWithPricing = data.map((offering) => {
      const activePrice = this.priceFor(prices, offering.productType?.code);
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

      // Precio por consulta YA con el descuento del pack repartido (total/quantity).
      // Si no hay descuento, coincide con unitPrice. Es un valor de DISPLAY: se
      // redondea a peso, así que unitPriceWithDiscount × quantity puede diferir
      // del total en unos pocos pesos. Lo que se cobra es siempre `total`.
      const unitPriceWithDiscount =
        pricing && offering.quantity > 0
          ? Math.round(pricing.total / offering.quantity)
          : null;

      return {
        ...offering,
        currency: activePrice?.currencyCode ?? 'COP',
        unitPrice: pricing?.unitPrice ?? null, // precio por consulta vigente (sin descuento)
        unitPriceWithDiscount, // precio por consulta con el descuento del pack aplicado
        subtotal: pricing?.subtotal ?? null, // quantity × unitPrice (sin descuento)
        discountAmount: pricing?.discountAmount ?? null, // cuánto descuenta
        total: pricing?.total ?? null, // total a pagar (con descuento)
      };
    });

    return {
      data: dataWithPricing,
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

    // Los campos de PRODUCTO quedan congelados: cambiar quantity/validityDays/
    // descuento desincronizaría las AnalysisPack ya compradas que apuntan a esta
    // oferta (verían valores distintos a los que pagaron). Solo se permite editar
    // nombre, descripción e isActive (retirar/reactivar del catálogo). Para
    // "cambiar" una oferta vendida, créese una nueva y retírese esta (isActive=false).
    const frozenFields = [
      'quantity',
      'validityDays',
      'hasDiscount',
      'discountTypeId',
      'discountValue',
      'productTypeCode',
      'sortOrder',
    ] as const;
    const attempted = frozenFields.filter((f) => dto[f] !== undefined);
    if (attempted.length > 0) {
      throw new ConflictException(
        `Una oferta de bolsa solo permite editar nombre, descripción y estado ` +
          `(isActive). No se puede modificar: ${attempted.join(', ')}. ` +
          `Para cambiar el número de consultas, vigencia, descuento o producto, ` +
          `cree una nueva oferta y retire esta (isActive=false).`,
      );
    }

    return this.repository.update(id, {
      name: dto.name,
      description: dto.description,
      isActive: dto.isActive,
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
   * contra el ConsultationPrice vigente DE SU PRODUCTO (− descuento por
   * volumen). El front solo pinta; nunca calcula precio. Una oferta cuyo
   * producto no tiene precio activo NO sale (no se puede cotizar) — así el
   * front esconde solo el carrusel de ese producto, no todo el catálogo.
   */
  async getCatalog() {
    const [offerings, prices] = await Promise.all([
      this.repository.findOfferable(),
      this.getActivePrices(),
    ]);

    return offerings.flatMap((offering) => {
      const activePrice = this.priceFor(prices, offering.productType?.code);
      if (!activePrice) return [];

      const pricing = calculatePackPrice({
        quantity: offering.quantity,
        unitPrice: activePrice.unitPrice,
        hasDiscount: offering.hasDiscount,
        discountTypeCode: offering.discountType?.code as
          | DiscountTypeCode
          | undefined,
        discountValue: offering.discountValue,
      });

      // Desglose de IVA con la tarifa vigente, para que el front muestre
      // base + impuesto sin calcular nada. Se aplica sobre `total` (ya con el
      // descuento por volumen), igual que en la compra — ahí el código
      // promocional entra ANTES del impuesto, así que si el usuario aplica uno
      // el desglose definitivo lo devuelve /purchase, no este catálogo.
      const tax = calculateTax(
        pricing.total,
        Number(activePrice.taxRate),
        activePrice.taxIncluded,
      );

      return [
        {
          id: offering.id,
          name: offering.name,
          description: offering.description,
          quantity: offering.quantity,
          validityDays: offering.validityDays,
          sortOrder: offering.sortOrder,
          // Con qué producto separa el front los carruseles.
          product: offering.productType
            ? {
                code: offering.productType.code,
                label: offering.productType.label,
              }
            : null,
          currency: activePrice.currencyCode,
          unitPrice: pricing.unitPrice,
          subtotal: pricing.subtotal,
          discountAmount: pricing.discountAmount,
          // Valor comercial del pack (con descuento por volumen, sin IVA sumado).
          total: pricing.total,
          // Desglose fiscal: base + amount = totalToCharge.
          tax: {
            rate: tax.taxRate,
            included: tax.taxIncluded, // true = `total` YA trae el IVA
            base: tax.base,
            amount: tax.taxAmount,
          },
          // Lo que se le cobrará al cliente. Con IVA incluido es igual a `total`;
          // si el precio vigente NO lo incluye, es total + IVA. Es el número que
          // debe mostrar el front como "total a pagar".
          totalToCharge: tax.total,
        },
      ];
    });
  }
}
