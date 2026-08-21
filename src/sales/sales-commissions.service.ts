import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SalesRepository } from './sales.repository.js';
import type { SalesCaller } from './sales.types.js';
import {
  FilterCommissionDto,
  FilterCommissionSummaryDto,
} from './dto/filter-commission.dto.js';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto.js';
import { bogotaAccrualMonth } from '../common/utils/bogota-date.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Tipo de venta que se comisiona. */
export type CommissionKind = 'new' | 'recurring';

@Injectable()
export class SalesCommissionsService {
  private readonly logger = new Logger(SalesCommissionsService.name);

  constructor(private readonly repository: SalesRepository) {}

  private async statusIdByCode(code: string): Promise<number> {
    const status = await this.repository.findParameterByTypeAndCode(
      'sales_commission_status',
      code,
    );
    if (!status) {
      throw new NotFoundException(
        `Falta el parámetro sales_commission_status='${code}'`,
      );
    }
    return status.id;
  }

  // ── Causación (la dispara el webhook de pago) ─────────────────────────

  /**
   * Causa la comisión de una bolsa recién pagada. Se llama desde el webhook de
   * ePayco justo después de activar la bolsa, en el mismo punto donde se canjea
   * el código promocional.
   *
   * No lanza nunca: es best-effort. Un problema aquí no puede tumbar el webhook
   * ni impedir que el cliente reciba lo que compró — la comisión se puede
   * reconstruir después desde la bolsa.
   *
   * Idempotente por partida doble: se consulta antes y, si dos webhooks entran
   * a la vez, el @unique de analysis_pack_id corta al segundo (P2002).
   */
  async accrueForPack(packId: string): Promise<void> {
    try {
      const pack = await this.repository.findPackForAccrual(packId);
      if (!pack) return;

      const referral = await this.repository.findReferralByCompany(
        pack.companyId,
      );
      // Venta directa: la empresa no la trajo nadie, no hay nada que comisionar.
      if (!referral) return;

      const already = await this.repository.findCommissionByPack(packId);
      if (already) {
        this.logger.log(
          `Bolsa ${packId} ya tenía comisión causada (${already.id}); no se duplica`,
        );
        return;
      }

      // Base = base gravable congelada. Las bolsas anteriores al desglose fiscal
      // no la tienen; para esas se usa el total (no había IVA discriminado).
      const base = pack.taxBase ?? pack.totalPaid;
      if (base <= 0) {
        // Bolsa sin costo (código promocional del 100%): no hubo ingreso, así
        // que tampoco comisión — y NO consume el bono de cliente nuevo, que se
        // aplicará a la primera compra que sí facture.
        this.logger.log(
          `Bolsa ${packId} sin costo; no causa comisión para ${referral.salesRep.code}`,
        );
        return;
      }

      const paidAt = pack.paidAt ?? new Date();

      // Primera compra facturada de la empresa vs recompra.
      const earlierPurchases = await this.repository.countEarlierPaidPacks(
        pack.companyId,
        packId,
        paidAt,
      );
      const kind: CommissionKind = earlierPurchases === 0 ? 'new' : 'recurring';

      const percent =
        kind === 'new'
          ? referral.newCustomerPercent
          : referral.recurringPercent;
      const commissionAmount = Math.round((base * Number(percent)) / 100);

      await this.repository.createCommission({
        analysisPackId: packId,
        salesRepId: referral.salesRepId,
        companyId: pack.companyId,
        companyReferralId: referral.companyId,
        commissionPlanId: referral.commissionPlanId,
        kind,
        percentApplied: percent,
        baseAmount: base,
        commissionAmount,
        currencyCode: pack.currencyCode,
        accrualMonth: bogotaAccrualMonth(paidAt),
        accruedAt: paidAt,
        statusId: await this.statusIdByCode('pending'),
      });

      this.logger.log(
        `Comisión causada: ${referral.salesRep.code} gana ${commissionAmount} ` +
          `${pack.currencyCode} (${percent.toString()}% de ${base}, ${kind}) por la bolsa ${packId}`,
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Webhooks concurrentes: el otro ya la creó. Resultado correcto.
        this.logger.log(
          `Bolsa ${packId}: comisión ya causada por otro webhook`,
        );
        return;
      }
      this.logger.error(
        `No se pudo causar la comisión de la bolsa ${packId}: ${
          (e as Error).message
        }`,
      );
    }
  }

  /**
   * Causa las comisiones de las compras que la empresa YA pagó y que aún no
   * comisionaron. Se dispara al vincularle un vendedor: sin esto, el cliente que
   * olvidó poner el código en el registro le costaría al vendedor justo el 30%
   * de la primera venta, que es lo que más pesa.
   *
   * Se recorren de la más antigua a la más reciente y cada una se causa con
   * accrueForPack, que ya clasifica bien por fecha de pago: la primera queda
   * como cliente nuevo y las demás como recompras. Cada comisión se registra en
   * su MES REAL de pago, no en el mes en que se vinculó, para no deformar el
   * consolidado mes a mes.
   *
   * Solo la llama assignReferral dentro de la ventana de asignación.
   */
  async accrueBacklogForCompany(companyId: string): Promise<{
    count: number;
    totalAmount: number;
  }> {
    const pending =
      await this.repository.findPaidPacksWithoutCommission(companyId);

    // En serie a propósito: cada bolsa mira cuántas compras hubo antes que ella,
    // así que la anterior debe estar ya escrita antes de evaluar la siguiente.
    for (const pack of pending) {
      await this.accrueForPack(pack.id);
    }

    const created = await Promise.all(
      pending.map((pack) => this.repository.findCommissionByPack(pack.id)),
    );
    const accrued = created.filter((c) => c !== null);
    const totalAmount = accrued.reduce((sum, c) => sum + c.commissionAmount, 0);

    if (accrued.length > 0) {
      this.logger.log(
        `Backlog liquidado para la empresa ${companyId}: ${accrued.length} comisión(es) por ${totalAmount}`,
      );
    }
    return { count: accrued.length, totalAmount };
  }

  /**
   * Cuánto causaría vincular un vendedor a esta empresa, SIN escribir nada.
   * Alimenta el aviso de confirmación del panel ("esto causará N por $X").
   */
  async previewBacklog(
    companyId: string,
    newCustomerPercent: number,
    recurringPercent: number,
  ) {
    const pending =
      await this.repository.findPaidPacksWithoutCommission(companyId);

    let total = 0;
    const items = [];
    for (const [index, { id }] of pending.entries()) {
      const pack = await this.repository.findPackForAccrual(id);
      if (!pack) continue;
      const base = pack.taxBase ?? pack.totalPaid;
      if (base <= 0) continue; // bolsa sin costo: no comisiona

      const earlier = await this.repository.countEarlierPaidPacks(
        pack.companyId,
        pack.id,
        pack.paidAt ?? new Date(),
      );
      const kind: CommissionKind = earlier === 0 ? 'new' : 'recurring';
      const percent = kind === 'new' ? newCustomerPercent : recurringPercent;
      const amount = Math.round((base * percent) / 100);
      total += amount;
      items.push({
        packId: pack.id,
        paidAt: pack.paidAt,
        kind,
        percent,
        base,
        amount,
        index,
      });
    }

    return { count: items.length, totalAmount: total, items };
  }

  /**
   * Anula la comisión de una bolsa cuyo pago se reversó. La fila NO se borra:
   * queda en 'cancelled' para que el histórico muestre qué pasó. Si ya se le
   * había pagado al vendedor, se deja como está y se avisa: eso se concilia a
   * mano, no descontando en silencio.
   */
  async cancelForPack(packId: string, reason: string): Promise<void> {
    try {
      const commission = await this.repository.findCommissionByPack(packId);
      if (!commission) return;

      const paidStatusId = await this.statusIdByCode('paid');
      if (commission.statusId === paidStatusId) {
        this.logger.warn(
          `Bolsa ${packId} reversada pero su comisión ${commission.id} YA fue pagada ` +
            `al vendedor; requiere conciliación manual`,
        );
        return;
      }

      await this.repository.updateCommission(commission.id, {
        statusId: await this.statusIdByCode('cancelled'),
        payoutNotes: reason,
      });
      this.logger.log(`Comisión ${commission.id} anulada: ${reason}`);
    } catch (e) {
      this.logger.error(
        `No se pudo anular la comisión de la bolsa ${packId}: ${
          (e as Error).message
        }`,
      );
    }
  }

  // ── Consultas ─────────────────────────────────────────────────────────

  /**
   * Acota el filtro al alcance de quien consulta: un vendedor solo ve sus
   * comisiones, pase lo que pase en el query string.
   */
  private scopeSalesRepId(
    caller: SalesCaller,
    requested: string | undefined,
  ): string | null {
    if (!caller.isAdmin) return caller.salesRepId;
    return requested ?? null;
  }

  async findCommissions(filters: FilterCommissionDto, caller: SalesCaller) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;

    const salesRepId = this.scopeSalesRepId(caller, filters.salesRepId);
    const where: Prisma.SalesCommissionWhereInput = {};

    // Un usuario del portal sin ficha de vendedor y sin rol admin no tiene
    // comisiones propias que ver: se devuelve vacío en vez de todo.
    if (!caller.isAdmin && !salesRepId) {
      return {
        data: [],
        totals: { count: 0, baseAmount: 0, commissionAmount: 0 },
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }

    if (salesRepId) where.salesRepId = salesRepId;
    if (filters.companyId) where.companyId = filters.companyId;
    if (filters.kind) where.kind = filters.kind;
    if (filters.status) {
      where.statusId = await this.statusIdByCode(filters.status);
    }
    if (filters.fromMonth || filters.toMonth) {
      where.accrualMonth = {
        ...(filters.fromMonth ? { gte: filters.fromMonth } : {}),
        ...(filters.toMonth ? { lte: filters.toMonth } : {}),
      };
    }

    const [{ data, total }, totals] = await Promise.all([
      this.repository.findCommissions({
        skip: (page - 1) * limit,
        take: limit,
        where,
      }),
      this.repository.sumCommissions(where),
    ]);

    return {
      data,
      totals, // acumulados del filtro completo, no solo de la página
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Consolidado mes a mes: la vista principal del vendedor y del admin. */
  async monthlySummary(
    filters: FilterCommissionSummaryDto,
    caller: SalesCaller,
  ) {
    const salesRepId = this.scopeSalesRepId(caller, filters.salesRepId);
    if (!caller.isAdmin && !salesRepId) return { data: [] };

    const data = await this.repository.monthlySummary({
      salesRepId,
      fromMonth: filters.fromMonth ?? null,
      toMonth: filters.toMonth ?? null,
    });
    return { data };
  }

  /** Cambia el estado de una comisión (liquidarla, revertirla o anularla). */
  async updateStatus(
    id: string,
    dto: UpdateCommissionStatusDto,
    caller: SalesCaller,
  ) {
    if (!caller.isAdmin) {
      // Un vendedor no puede marcarse sus propias comisiones como pagadas.
      throw new NotFoundException('Comisión no encontrada');
    }

    const commission = await this.repository.findCommissionById(id);
    if (!commission) {
      throw new NotFoundException(`Comisión con id=${id} no encontrada`);
    }

    const data: Prisma.SalesCommissionUncheckedUpdateInput = {
      statusId: await this.statusIdByCode(dto.status),
      // paidAt/paidBy solo tienen sentido en 'paid'; al revertir se limpian
      // para no dejar un rastro de pago que no ocurrió.
      paidAt: dto.status === 'paid' ? new Date() : null,
      paidBy: dto.status === 'paid' ? caller.platformAdminId : null,
    };
    if (dto.payoutNotes !== undefined) data.payoutNotes = dto.payoutNotes;

    return this.repository.updateCommission(id, data);
  }

  /**
   * Resumen de cabecera del vendedor logueado: lo del mes en curso, el
   * acumulado histórico y lo que está pendiente de cobro.
   */
  async mySummary(caller: SalesCaller) {
    if (!caller.salesRepId) {
      return { salesRep: null, currentMonth: null, totals: null };
    }

    const rep = await this.repository.findRepById(caller.salesRepId);
    const month = bogotaAccrualMonth(new Date());
    const pendingStatusId = await this.statusIdByCode('pending');
    const cancelledStatusId = await this.statusIdByCode('cancelled');

    const [currentMonth, allTime, pending] = await Promise.all([
      this.repository.sumCommissions({
        salesRepId: caller.salesRepId,
        accrualMonth: month,
        statusId: { not: cancelledStatusId },
      }),
      this.repository.sumCommissions({
        salesRepId: caller.salesRepId,
        statusId: { not: cancelledStatusId },
      }),
      this.repository.sumCommissions({
        salesRepId: caller.salesRepId,
        statusId: pendingStatusId,
      }),
    ]);

    return {
      salesRep: rep && {
        id: rep.id,
        code: rep.code,
        isActive: rep.isActive,
        companies: rep._count.referrals,
      },
      currentMonth: { month, ...currentMonth },
      totals: { allTime, pending },
    };
  }
}
