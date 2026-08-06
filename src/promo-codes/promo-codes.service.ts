import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  PromoCodesRepository,
  type PromoRedeemParams,
} from './promo-codes.repository.js';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto.js';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto.js';
import { FilterPromoCodeDto } from './dto/filter-promo-code.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Resultado de validar un código para una compra concreta. */
export interface PromoValidation {
  valid: boolean;
  reason?: string;
  promoCodeId?: string;
  code?: string;
  discountPercent?: number;
}

@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  constructor(private readonly repository: PromoCodesRepository) {}

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  // ── CRUD (panel admin) ────────────────────────────────────────────────

  async create(dto: CreatePromoCodeDto, userId: string) {
    const admin = await this.repository.findPlatformAdminByUserId(userId);

    const scope = await this.repository.findParameterByTypeAndCode(
      'promo_code_scope',
      dto.scope,
    );
    if (!scope) {
      throw new BadRequestException(`Scope inválido: ${dto.scope}`);
    }

    const code = this.normalizeCode(dto.code);
    const existing = await this.repository.findByCode(code);
    if (existing) {
      throw new ConflictException(`Ya existe un código con el texto "${code}"`);
    }

    // company → atado a 1 empresa, 1 solo uso. global → cupo configurable.
    const companyId = dto.scope === 'company' ? dto.companyId! : null;
    const maxRedemptions =
      dto.scope === 'company' ? 1 : (dto.maxRedemptions ?? 1);

    if (dto.scope === 'company' && !companyId) {
      throw new BadRequestException(
        'companyId es requerido para un código de empresa',
      );
    }

    return this.repository.create({
      code,
      scopeId: scope.id,
      companyId,
      discountPercent: new Prisma.Decimal(dto.discountPercent),
      maxRedemptions,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      isActive: dto.isActive ?? true,
      description: dto.description ?? null,
      createdBy: admin?.id ?? null,
    });
  }

  private async buildWhere(
    filters: FilterPromoCodeDto,
  ): Promise<Prisma.PromoCodeWhereInput> {
    const where: Prisma.PromoCodeWhereInput = {};

    if (filters.scope) {
      const scope = await this.repository.findParameterByTypeAndCode(
        'promo_code_scope',
        filters.scope,
      );
      where.scopeId = scope?.id ?? -1;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive === 'true';
    }
    if (filters.companyId) {
      where.companyId = filters.companyId;
    }
    if (filters.search) {
      where.code = { contains: filters.search.toUpperCase() };
    }
    return where;
  }

  async findAll(filters: FilterPromoCodeDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where = await this.buildWhere(filters);

    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
    });
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const promo = await this.repository.findById(id);
    if (!promo) {
      throw new NotFoundException(`Código con id=${id} no encontrado`);
    }
    return promo;
  }

  /**
   * Edición acotada: solo isActive, vigencia y nota. El code, scope, %, empresa
   * y cupo son inmutables (cambiarlos rompería la consistencia con los canjes).
   */
  async update(id: string, dto: UpdatePromoCodeDto) {
    await this.findOne(id);

    const data: Prisma.PromoCodeUncheckedUpdateInput = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.validFrom !== undefined)
      data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.validUntil !== undefined)
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;

    return this.repository.update(id, data);
  }

  // ── Validación para compra (front + purchase) ─────────────────────────

  /**
   * Valida un código para una empresa concreta SIN canjearlo (read-only).
   * Sirve para que el front muestre el descuento antes de pagar y para que el
   * purchase congele el % en la bolsa. El canje real ocurre en el webhook.
   */
  async validateForPurchase(
    rawCode: string,
    companyId: string,
  ): Promise<PromoValidation> {
    const code = this.normalizeCode(rawCode);
    const promo = await this.repository.findByCode(code);

    if (!promo)
      return { valid: false, reason: 'No existe un código con ese texto' };
    if (!promo.isActive)
      return { valid: false, reason: 'El código está inactivo' };
    if (promo.redemptionsCount >= promo.maxRedemptions)
      return {
        valid: false,
        reason: 'El código ya agotó sus usos disponibles',
      };

    const now = new Date();
    if (promo.validFrom && now < promo.validFrom)
      return { valid: false, reason: 'El código todavía no está vigente' };
    if (promo.validUntil && now > promo.validUntil)
      return { valid: false, reason: 'El código ya venció' };

    // company-scope: debe ser la empresa dueña del código.
    if (promo.companyId && promo.companyId !== companyId)
      return { valid: false, reason: 'Este código no aplica a tu empresa' };

    // Una empresa, un canje.
    const already = await this.repository.findRedemption(promo.id, companyId);
    if (already)
      return { valid: false, reason: 'Tu empresa ya utilizó este código' };

    return {
      valid: true,
      promoCodeId: promo.id,
      code: promo.code,
      discountPercent: Number(promo.discountPercent),
    };
  }

  // ── Canje (webhook) ───────────────────────────────────────────────────

  /** Canjea el cupo de forma atómica. Devuelve el resultado del repo. */
  async redeem(params: PromoRedeemParams) {
    return this.repository.redeem(params);
  }

  /**
   * Canje dentro de una transacción ya abierta por el caller. Lo usa la compra
   * SIN COSTO (código del 100%), donde el canje debe ser atómico con la creación
   * de la bolsa: sin pago posterior no hay webhook que lo haga después.
   */
  async redeemInTx(tx: Prisma.TransactionClient, params: PromoRedeemParams) {
    return this.repository.redeemInTx(tx, params);
  }

  /** Libera el cupo (reversa de pago). */
  async release(promoCodeId: string, companyId: string) {
    return this.repository.releaseRedemption(promoCodeId, companyId);
  }
}
