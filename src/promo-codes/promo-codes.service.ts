import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  PromoCodesRepository,
  type PromoRedeemParams,
} from './promo-codes.repository.js';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto.js';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto.js';
import { FilterPromoCodeDto } from './dto/filter-promo-code.dto.js';
import {
  calculatePackPrice,
  calculateTax,
  type DiscountTypeCode,
} from '../common/utils/pack-pricing.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Resultado de validar un código para una compra concreta. */
export interface PromoValidation {
  valid: boolean;
  reason?: string;
  promoCodeId?: string;
  code?: string;
  discountPercent?: number;
  /** 'any' | 'first_purchase' — para que el front explique el descuento. */
  appliesTo?: string;
  /** Vendedor que financia el descuento; null si lo pone Creditia. */
  salesRepId?: string | null;
}

/** Quién está operando sobre los códigos y con qué alcance. */
interface PromoCaller {
  platformAdminId: string;
  isAdmin: boolean;
  /** Ficha de vendedor del usuario, si la tiene (un admin también puede vender). */
  salesRepId: string | null;
  salesRepCode: string | null;
  salesRepIsActive: boolean;
}

@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  constructor(private readonly repository: PromoCodesRepository) {}

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Resuelve el alcance de quien llama. El AdminGuard ya garantizó que es un
   * usuario del portal; aquí se distingue admin de vendedor, sabiendo que una
   * misma persona puede ser las dos cosas.
   */
  private async resolveCaller(userId: string): Promise<PromoCaller> {
    const admin = await this.repository.findPlatformAdminByUserId(userId);
    if (!admin || !admin.isActive) {
      throw new ForbiddenException('No tienes acceso al portal');
    }
    return {
      platformAdminId: admin.id,
      isAdmin: admin.role?.code === 'admin',
      salesRepId: admin.salesRep?.id ?? null,
      salesRepCode: admin.salesRep?.code ?? null,
      salesRepIsActive: admin.salesRep?.isActive ?? false,
    };
  }

  private async parameterIdByCode(type: string, code: string): Promise<number> {
    const parameter = await this.repository.findParameterByTypeAndCode(
      type,
      code,
    );
    if (!parameter) {
      throw new NotFoundException(`Falta el parámetro ${type}='${code}'`);
    }
    return parameter.id;
  }

  // ── CRUD (panel admin y panel del vendedor) ───────────────────────────

  /**
   * Decide quién financia el descuento y valida que quien llama pueda hacerlo.
   *
   * - Vendedor puro          → siempre lo financia él.
   * - Admin sin ficha        → siempre lo financia Creditia.
   * - Admin que además vende → tiene que elegir; por defecto, Creditia.
   */
  private resolveFunding(
    dto: CreatePromoCodeDto,
    caller: PromoCaller,
  ): string | null {
    const fundedBy =
      dto.fundedBy ??
      (caller.salesRepId && !caller.isAdmin ? 'sales_rep' : 'creditia');

    if (fundedBy === 'sales_rep') {
      if (!caller.salesRepId) {
        throw new ForbiddenException(
          'No tienes ficha de vendedor, así que no puedes financiar descuentos con tu comisión',
        );
      }
      if (!caller.salesRepIsActive) {
        throw new ForbiddenException(
          'Tu ficha de vendedor está inactiva en el programa',
        );
      }
      return caller.salesRepId;
    }

    // Los códigos que paga Creditia salen del margen de la casa: solo admin.
    if (!caller.isAdmin) {
      throw new ForbiddenException(
        'Solo un administrador puede crear códigos financiados por Creditia',
      );
    }
    return null;
  }

  async create(dto: CreatePromoCodeDto, userId: string) {
    const caller = await this.resolveCaller(userId);
    const salesRepId = this.resolveFunding(dto, caller);
    const isSalesRepFunded = salesRepId !== null;

    // Un código de vendedor es siempre una herramienta de captación: aplica solo
    // a la primera compra y circula abierto (él no ve empresas para atarlo a una).
    const appliesToCode = isSalesRepFunded
      ? 'first_purchase'
      : (dto.appliesTo ?? 'any');
    const scopeCode = isSalesRepFunded ? 'global' : dto.scope;

    if (isSalesRepFunded) {
      if (dto.scope === 'company') {
        throw new BadRequestException(
          'Un código de vendedor no se ata a una empresa: se entrega al cliente antes de que compre',
        );
      }
      if (dto.appliesTo && dto.appliesTo !== 'first_purchase') {
        throw new BadRequestException(
          'Un código de vendedor solo puede aplicar a la primera compra',
        );
      }
      if (!dto.validUntil) {
        throw new BadRequestException(
          'Un código de vendedor necesita fecha de vencimiento',
        );
      }

      const plan = await this.repository.findActiveCommissionPlan();
      if (!plan) {
        throw new NotFoundException(
          'No hay un plan de comisiones vigente; sin él no se puede fijar el techo del descuento',
        );
      }
      const ceiling = Number(plan.maxNewCustomerDiscount);
      if (dto.discountPercent > ceiling) {
        throw new BadRequestException(
          `El descuento máximo que puedes otorgar es ${ceiling}%: sale de tu comisión ` +
            `y por encima de ese tope Creditia estaría pagando por vender.`,
        );
      }
    }

    const scopeId = await this.parameterIdByCode('promo_code_scope', scopeCode);
    const appliesToId = await this.parameterIdByCode(
      'promo_code_applies_to',
      appliesToCode,
    );

    const code = this.normalizeCode(dto.code);
    const existing = await this.repository.findByCode(code);
    if (existing) {
      throw new ConflictException(`Ya existe un código con el texto "${code}"`);
    }

    // company → atado a 1 empresa, 1 solo uso. global → cupo configurable.
    const companyId = scopeCode === 'company' ? dto.companyId! : null;
    const maxRedemptions =
      scopeCode === 'company' ? 1 : (dto.maxRedemptions ?? 1);

    if (scopeCode === 'company' && !companyId) {
      throw new BadRequestException(
        'companyId es requerido para un código de empresa',
      );
    }

    const created = await this.repository.create({
      code,
      scopeId,
      appliesToId,
      salesRepId,
      companyId,
      discountPercent: new Prisma.Decimal(dto.discountPercent),
      maxRedemptions,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      isActive: dto.isActive ?? true,
      description: dto.description ?? null,
      createdBy: caller.platformAdminId,
    });

    if (isSalesRepFunded) {
      this.logger.log(
        `Código de vendedor ${code} creado por ${caller.salesRepCode}: ` +
          `${dto.discountPercent}% de descuento en primera compra, ${maxRedemptions} uso(s)`,
      );
    }
    return created;
  }

  private async buildWhere(
    filters: FilterPromoCodeDto,
    caller: PromoCaller,
  ): Promise<Prisma.PromoCodeWhereInput> {
    const where: Prisma.PromoCodeWhereInput = {};

    // -1 cuando el parámetro no existe: filtra a vacío en vez de reventar.
    if (filters.scope) {
      const scope = await this.repository.findParameterByTypeAndCode(
        'promo_code_scope',
        filters.scope,
      );
      where.scopeId = scope?.id ?? -1;
    }
    if (filters.appliesTo) {
      const appliesTo = await this.repository.findParameterByTypeAndCode(
        'promo_code_applies_to',
        filters.appliesTo,
      );
      where.appliesToId = appliesTo?.id ?? -1;
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

    // Un vendedor solo ve los suyos, diga lo que diga el query string. El admin
    // ve todo y puede filtrar por financiador. (Para un no-admin, salesRepId
    // nunca es null aquí: findAll corta antes si no tiene ficha.)
    if (!caller.isAdmin && caller.salesRepId) {
      where.salesRepId = caller.salesRepId;
    } else if (caller.isAdmin && filters.mine === 'true') {
      // "Mis códigos": los que emití yo, más los que financia mi comisión si
      // además soy vendedor. Un admin no debe ver ahí los de los demás.
      where.OR = [
        { createdBy: caller.platformAdminId },
        ...(caller.salesRepId ? [{ salesRepId: caller.salesRepId }] : []),
      ];
    } else if (caller.isAdmin && filters.fundedBy) {
      where.salesRepId =
        filters.fundedBy === 'creditia' ? null : filters.fundedBy;
    }

    return where;
  }

  async findAll(filters: FilterPromoCodeDto, userId: string) {
    const caller = await this.resolveCaller(userId);

    // Usuario del portal que no es admin ni vendedor: no hay códigos suyos.
    if (!caller.isAdmin && !caller.salesRepId) {
      const page = filters.page ?? 1;
      const limit = filters.limit ?? 10;
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where = await this.buildWhere(filters, caller);

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

  async findOne(id: string, userId: string) {
    const caller = await this.resolveCaller(userId);
    const promo = await this.repository.findById(id);
    if (!promo) {
      throw new NotFoundException(`Código con id=${id} no encontrado`);
    }
    if (!caller.isAdmin && promo.salesRepId !== caller.salesRepId) {
      throw new ForbiddenException('Este código no es tuyo');
    }
    return promo;
  }

  /**
   * Edición acotada: solo isActive, vigencia y nota. El code, scope, tipo, %,
   * empresa, financiador y cupo son inmutables (cambiarlos rompería la
   * consistencia con los canjes y con las comisiones ya causadas).
   */
  async update(id: string, dto: UpdatePromoCodeDto, userId: string) {
    await this.findOne(id, userId); // valida existencia y propiedad

    const data: Prisma.PromoCodeUncheckedUpdateInput = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.validFrom !== undefined)
      data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.validUntil !== undefined)
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;

    return this.repository.update(id, data);
  }

  /**
   * Techo vigente del descuento y la base sobre la que el vendedor hace cuentas.
   *
   * La base de referencia se calcula aquí y no en el front porque depende de si
   * el catálogo maneja los precios con IVA incluido o no, y la comisión va
   * SIEMPRE sobre la base gravable. Que el front lo adivine es pedir un error.
   */
  async getDiscountCeiling() {
    const plan = await this.repository.findActiveCommissionPlan();
    if (!plan) {
      throw new NotFoundException('No hay un plan de comisiones vigente');
    }

    const basis = await this.repository.findSimulationBasis();
    const reference = basis
      ? (() => {
          const pricing = calculatePackPrice({
            quantity: basis.offering.quantity,
            unitPrice: basis.price.unitPrice,
            hasDiscount: basis.offering.hasDiscount,
            discountTypeCode: basis.offering.discountType?.code as
              | DiscountTypeCode
              | undefined,
            discountValue: basis.offering.discountValue,
          });
          const tax = calculateTax(
            pricing.total,
            Number(basis.price.taxRate),
            basis.price.taxIncluded,
          );
          return {
            offeringName: basis.offering.name,
            quantity: basis.offering.quantity,
            listBase: tax.base,
            currencyCode: basis.price.currencyCode,
          };
        })()
      : null;

    return {
      commissionPlanId: plan.id,
      planName: plan.name,
      maxDiscountPercent: Number(plan.maxNewCustomerDiscount),
      newCustomerPercent: Number(plan.newCustomerPercent),
      reference,
    };
  }

  // ── Validación para compra (front + purchase) ─────────────────────────

  /**
   * Valida un código para una empresa concreta SIN canjearlo (read-only).
   * Sirve para que el front muestre el descuento antes de pagar y para que el
   * purchase congele el % en la bolsa. El canje real ocurre en el webhook.
   *
   * Dos reglas propias de los códigos de vendedor:
   *  - Solo primera compra: es una herramienta de captación, no un descuento
   *    permanente (en recompra su comisión es 10%, no 30%).
   *  - Solo empresas YA vinculadas a ÉL: el código descuenta, nunca atribuye.
   *    Si atribuyera, bastaría con publicarlo para cosechar clientes que llegaron
   *    solos y quedarse con el 10% vitalicio de cada uno.
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

    // Código de vendedor: la empresa tiene que ser suya.
    if (promo.salesRepId) {
      const referral = await this.repository.findCompanyReferral(companyId);
      if (!referral) {
        return {
          valid: false,
          reason:
            'Este código pertenece a un asesor comercial y tu empresa no tiene un asesor ' +
            'asociado. Contacta a soporte para que lo registren y podrás aplicarlo.',
        };
      }
      if (referral.salesRepId !== promo.salesRepId) {
        return {
          valid: false,
          reason:
            'Este código pertenece a otro asesor comercial. Verifica el código con el tuyo.',
        };
      }
    }

    if (promo.appliesTo.code === 'first_purchase') {
      const paidPacks = await this.repository.countPaidPacks(companyId);
      if (paidPacks > 0) {
        return {
          valid: false,
          reason: 'Este código solo aplica a la primera compra de tu empresa.',
        };
      }
    }

    return {
      valid: true,
      promoCodeId: promo.id,
      code: promo.code,
      discountPercent: Number(promo.discountPercent),
      appliesTo: promo.appliesTo.code,
      salesRepId: promo.salesRepId,
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
