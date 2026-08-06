import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Motivo por el que un canje no pudo realizarse (resultado esperado, no error). */
export type PromoRedeemFailReason =
  | 'not_found'
  | 'inactive'
  | 'exhausted'
  | 'expired'
  | 'already_redeemed';

export type PromoRedeemResult =
  | { ok: true }
  | { ok: false; reason: PromoRedeemFailReason };

/** Datos de un canje (compartidos entre el canje propio y el transaccional). */
export interface PromoRedeemParams {
  promoCodeId: string;
  companyId: string;
  analysisPackId: string | null;
  redeemedBy: string | null;
  discountPercent: number;
  discountAmount: number;
}

@Injectable()
export class PromoCodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Para listar/leer: scope (label) + datos mínimos de empresa y creador.
  private readonly defaultInclude = {
    scope: { select: { code: true, label: true } },
    company: { select: { id: true, name: true, nit: true } },
  } as const;

  /** Parameter por type+code (scope del código). */
  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  /** PlatformAdmin por su userId de Supabase (para createdBy). */
  async findPlatformAdminByUserId(userId: string) {
    return this.prisma.platformAdmin.findUnique({ where: { userId } });
  }

  async create(data: Prisma.PromoCodeUncheckedCreateInput) {
    return this.prisma.promoCode.create({
      data,
      include: this.defaultInclude,
    });
  }

  async findById(id: string) {
    return this.prisma.promoCode.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  /** Código por su texto (ya normalizado a UPPERCASE por el service). */
  async findByCode(code: string) {
    return this.prisma.promoCode.findUnique({
      where: { code },
      include: this.defaultInclude,
    });
  }

  async findMany(params: {
    skip: number;
    take: number;
    where: Prisma.PromoCodeWhereInput;
  }) {
    const [data, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: this.defaultInclude,
      }),
      this.prisma.promoCode.count({ where: params.where }),
    ]);
    return { data, total };
  }

  async update(id: string, data: Prisma.PromoCodeUncheckedUpdateInput) {
    return this.prisma.promoCode.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  /** ¿La empresa ya canjeó este código? (regla "una vez por empresa"). */
  async findRedemption(promoCodeId: string, companyId: string) {
    return this.prisma.promoCodeRedemption.findUnique({
      where: {
        promoCodeId_companyId: { promoCodeId, companyId },
      },
    });
  }

  /**
   * Canjea un código de forma atómica: bloquea la fila (FOR UPDATE), re-valida
   * el cupo y las fechas DENTRO de la transacción, incrementa redemptionsCount
   * e inserta la redemption. Devuelve { ok } o un motivo de fallo, para que el
   * caller decida (en el webhook: activar igual + alertar si oversold).
   *
   * No lanza por cupo/uso repetido: esos son resultados esperados, no errores.
   */
  async redeem(params: PromoRedeemParams): Promise<PromoRedeemResult> {
    return this.prisma.$transaction((tx) => this.redeemInTx(tx, params));
  }

  /**
   * Núcleo del canje, ejecutable dentro de una transacción AJENA. Lo usa la
   * compra SIN COSTO (código del 100%): ahí no hay pago que confirme después,
   * así que el canje y la creación de la bolsa deben ser un solo átomo — si el
   * cupo ya no está, la bolsa gratuita no debe existir.
   */
  async redeemInTx(
    tx: Prisma.TransactionClient,
    params: PromoRedeemParams,
  ): Promise<PromoRedeemResult> {
    // Lock pesimista sobre la fila del código para serializar canjes
    // concurrentes que compitan por el último cupo.
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        is_active: boolean;
        max_redemptions: number;
        redemptions_count: number;
        valid_from: Date | null;
        valid_until: Date | null;
      }>
    >`SELECT id, is_active, max_redemptions, redemptions_count, valid_from, valid_until
        FROM promo_codes WHERE id = ${params.promoCodeId}::uuid FOR UPDATE`;

    const code = rows[0];
    if (!code) return { ok: false as const, reason: 'not_found' as const };
    if (!code.is_active)
      return { ok: false as const, reason: 'inactive' as const };
    if (code.redemptions_count >= code.max_redemptions)
      return { ok: false as const, reason: 'exhausted' as const };

    const now = new Date();
    if (
      (code.valid_from && now < code.valid_from) ||
      (code.valid_until && now > code.valid_until)
    ) {
      return { ok: false as const, reason: 'expired' as const };
    }

    // Una empresa, un canje (defensa además del @@unique).
    const existing = await tx.promoCodeRedemption.findUnique({
      where: {
        promoCodeId_companyId: {
          promoCodeId: params.promoCodeId,
          companyId: params.companyId,
        },
      },
    });
    if (existing)
      return { ok: false as const, reason: 'already_redeemed' as const };

    await tx.promoCodeRedemption.create({
      data: {
        promoCodeId: params.promoCodeId,
        companyId: params.companyId,
        analysisPackId: params.analysisPackId,
        redeemedBy: params.redeemedBy,
        discountPercent: params.discountPercent,
        discountAmount: params.discountAmount,
      },
    });

    await tx.promoCode.update({
      where: { id: params.promoCodeId },
      data: { redemptionsCount: { increment: 1 } },
    });

    return { ok: true as const };
  }

  /**
   * Libera el cupo de un canje (reversa de pago): borra la redemption de la
   * empresa para ese código y decrementa redemptionsCount, sin bajar de 0.
   * Idempotente: si no había canje, no hace nada.
   */
  async releaseRedemption(promoCodeId: string, companyId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.promoCodeRedemption.deleteMany({
        where: { promoCodeId, companyId },
      });
      if (deleted.count > 0) {
        await tx.$executeRaw`UPDATE promo_codes
          SET redemptions_count = GREATEST(redemptions_count - ${deleted.count}, 0)
          WHERE id = ${promoCodeId}::uuid`;
      }
      return deleted.count;
    });
  }
}
