import {
  Injectable,
  Logger,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SalesRepository } from './sales.repository.js';
import type { SalesCaller } from './sales.types.js';
import {
  FilterCommissionDto,
  FilterCommissionSummaryDto,
} from './dto/filter-commission.dto.js';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto.js';
import { CreatePayoutDto } from './dto/create-payout.dto.js';
import { renderPayoutReceiptHtml } from './pdf/commission-payout-receipt.renderer.js';
import { PdfService } from '../common/pdf/pdf.service.js';
import { MailService } from '../mail/mail.service.js';
import { bogotaAccrualMonth } from '../common/utils/bogota-date.js';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Tipo de venta que se comisiona. */
export type CommissionKind = 'new' | 'recurring';

/** Marcador para repartir sin vendedor: nunca casa con un salesRepId real. */
const NO_SALES_REP = '';

/** Bolsa con lo mínimo para liquidar: lo que devuelve findPackForAccrual. */
interface PackForAccrual {
  totalPaid: number;
  taxBase: number | null;
  listTaxBase: number | null;
  taxRatePaid: Prisma.Decimal | null;
  taxIncludedPaid: boolean | null;
  promoDiscountAmount: number | null;
  promoCode: { salesRepId: string | null } | null;
}

/** Cómo queda repartida una venta entre el vendedor y Creditia. */
interface CommissionSplit {
  /** Base gravable COBRADA (la que concilia con la factura). */
  chargedBase: number;
  /** Base sobre la que se calcula el bruto. */
  listBase: number;
  grossCommission: number;
  /** Descuento que el vendedor pagó de su propia comisión. */
  discountFunded: number;
  /** Lo que efectivamente se le paga. */
  netCommission: number;
}

@Injectable()
export class SalesCommissionsService {
  private readonly logger = new Logger(SalesCommissionsService.name);

  constructor(
    private readonly repository: SalesRepository,
    private readonly paymentAlerts: PaymentAlertsService,
    private readonly pdfService: PdfService,
    private readonly mailService: MailService,
  ) {}

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

  /**
   * Base gravable de LISTA de una bolsa, o sea antes del código promocional.
   *
   * Normalmente viene congelada en la bolsa. Las anteriores a esa columna se
   * reconstruyen sumándole el descuento a la base cobrada — para lo cual hay que
   * saber si el precio traía el IVA adentro, porque promoDiscountAmount se
   * calculó sobre el valor que se le pasó a calculateTax. Sin ese dato se asume
   * que no lo traía, que es como está configurado el catálogo.
   */
  private resolveListBase(pack: PackForAccrual, chargedBase: number): number {
    if (pack.listTaxBase !== null) return pack.listTaxBase;

    const discount = pack.promoDiscountAmount ?? 0;
    if (discount <= 0) return chargedBase;

    const rate = Number(pack.taxRatePaid ?? 0);
    const discountOnBase =
      pack.taxIncludedPaid && rate > 0
        ? Math.round(discount / (1 + rate / 100))
        : discount;
    return chargedBase + discountOnBase;
  }

  /**
   * Reparte una venta entre el vendedor y Creditia.
   *
   * Si el descuento lo financió ÉL con uno de sus códigos, la comisión se calcula
   * sobre la base de LISTA y se le resta lo que regaló:
   *
   *   neta = max(0, % × baseDeLista − descuentoOtorgado)
   *
   * Con eso el neto de Creditia no se mueve: el vendedor cambia comisión por
   * cierre 1 a 1, y al tope del plan su ganancia de esa venta es cero.
   *
   * Si el descuento lo puso Creditia (campaña propia), la comisión va sobre la
   * base COBRADA: ambos ceden en la misma proporción, que es el comportamiento
   * de siempre. El vendedor no gana sobre plata que Creditia no recibió, pero
   * tampoco paga un descuento que no otorgó.
   *
   * El piso en cero no debería activarse nunca —el techo del plan lo impide al
   * crear el código— pero cubre la carrera entre validar y causar: entre una
   * cosa y otra puede colarse otro pago y volver 'recurring' lo que se validó
   * como primera compra, con un % más bajo que el descuento ya otorgado.
   */
  private splitCommission(
    pack: PackForAccrual,
    percent: number,
    salesRepId: string,
  ): CommissionSplit {
    const chargedBase = pack.taxBase ?? pack.totalPaid;
    const selfFunded =
      pack.promoCode?.salesRepId != null &&
      pack.promoCode.salesRepId === salesRepId;

    const listBase = selfFunded
      ? this.resolveListBase(pack, chargedBase)
      : chargedBase;
    const discountFunded = selfFunded ? Math.max(0, listBase - chargedBase) : 0;

    const grossCommission = Math.round((listBase * percent) / 100);
    return {
      chargedBase,
      listBase,
      grossCommission,
      discountFunded,
      netCommission: Math.max(0, grossCommission - discountFunded),
    };
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
      const chargedBase = pack.taxBase ?? pack.totalPaid;
      if (chargedBase <= 0) {
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
      const split = this.splitCommission(
        pack,
        Number(percent),
        referral.salesRepId,
      );

      await this.repository.createCommission({
        analysisPackId: packId,
        salesRepId: referral.salesRepId,
        companyId: pack.companyId,
        companyReferralId: referral.companyId,
        commissionPlanId: referral.commissionPlanId,
        kind,
        percentApplied: percent,
        baseAmount: split.chargedBase,
        listBaseAmount: split.listBase,
        grossCommissionAmount: split.grossCommission,
        discountFundedAmount: split.discountFunded,
        commissionAmount: split.netCommission,
        currencyCode: pack.currencyCode,
        accrualMonth: bogotaAccrualMonth(paidAt),
        accruedAt: paidAt,
        statusId: await this.statusIdByCode('pending'),
      });

      this.logger.log(
        `Comisión causada: ${referral.salesRep.code} gana ${split.netCommission} ` +
          `${pack.currencyCode} (${percent.toString()}% de ${split.listBase}, ${kind}) ` +
          `por la bolsa ${packId}` +
          (split.discountFunded > 0
            ? `; financió ${split.discountFunded} de descuento con su comisión`
            : ''),
      );

      // El techo del plan impide que el descuento supere la comisión, así que
      // llegar a cero por recorte es señal de que la compra cambió de tipo entre
      // la validación y el pago. No es un error, pero hay que mirarlo.
      if (split.grossCommission < split.discountFunded) {
        this.logger.warn(
          `Bolsa ${packId}: el descuento otorgado (${split.discountFunded}) supera la ` +
            `comisión bruta (${split.grossCommission}) de ${referral.salesRep.code}. ` +
            `Se liquidó en 0; requiere revisión.`,
        );
      }
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
      const reason = (e as Error).message;
      this.logger.error(
        `No se pudo causar la comisión de la bolsa ${packId}: ${reason}`,
      );
      await this.alertAccrualFailure(packId, reason);
    }
  }

  /**
   * Deja rastro visible de una causación fallida. Sin esto el fallo vive solo en
   * el log: la venta se cobró, el vendedor no ve su comisión y nadie se entera
   * hasta que reclama. Se registra sobre la empresa de la bolsa para que caiga en
   * la bandeja de alertas del admin, que puede reintentarla desde ahí.
   *
   * A prueba de balas por diseño: si esto también falla, solo se loguea. Está en
   * el catch de un proceso que NO puede lanzar.
   */
  private async alertAccrualFailure(packId: string, reason: string) {
    try {
      const pack = await this.repository.findPackForAccrual(packId);
      if (!pack) return;
      await this.paymentAlerts.createAlert({
        companyId: pack.companyId,
        analysisPackId: packId,
        typeCode: 'commission_accrual_failed',
        severityCode: 'warning',
        title: 'Comisión de vendedor sin causar',
        message:
          `La bolsa ${packId} se pagó pero su comisión no pudo registrarse: ${reason}. ` +
          `La venta está firme; hay que reintentar la causación para que el vendedor cobre.`,
        metadata: { packId, reason },
      });
    } catch (alertError) {
      this.logger.error(
        `Tampoco se pudo alertar del fallo de causación de ${packId}: ${
          (alertError as Error).message
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
   *
   * Aquí nunca hay descuento financiado por el vendedor: un código suyo exige
   * que la empresa YA esté vinculada a él, y estas son justamente las compras de
   * una empresa sin vendedor. Se pasa un salesRepId imposible para que el
   * reparto use la base cobrada, que es lo correcto en este caso.
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
      if ((pack.taxBase ?? pack.totalPaid) <= 0) continue; // sin costo: no comisiona

      const earlier = await this.repository.countEarlierPaidPacks(
        pack.companyId,
        pack.id,
        pack.paidAt ?? new Date(),
      );
      const kind: CommissionKind = earlier === 0 ? 'new' : 'recurring';
      const percent = kind === 'new' ? newCustomerPercent : recurringPercent;
      const split = this.splitCommission(pack, percent, NO_SALES_REP);
      total += split.netCommission;
      items.push({
        packId: pack.id,
        paidAt: pack.paidAt,
        kind,
        percent,
        base: split.chargedBase,
        amount: split.netCommission,
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

  /**
   * Cambia el estado de una comisión suelta (liquidarla, revertirla o anularla).
   *
   * Si la comisión se pagó dentro de un lote, NO se toca por aquí: sacarla del
   * giro dejaría el comprobante diciendo un total que ya no suman sus líneas. En
   * ese caso se revierte el lote completo.
   */
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

    if (commission.payoutId) {
      throw new ConflictException(
        `Esta comisión se pagó dentro de la liquidación ${
          commission.payout?.reference ?? commission.payoutId
        }. Para cambiarla hay que revertir esa liquidación completa.`,
      );
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

  // ── Liquidación en lote ───────────────────────────────────────────────

  private assertIsAdmin(caller: SalesCaller) {
    if (!caller.isAdmin) {
      throw new ForbiddenException(
        'Solo un administrador puede liquidar comisiones',
      );
    }
  }

  /**
   * Qué se le giraría a un vendedor, SIN escribir nada. El panel lo muestra
   * antes de confirmar para que el admin cuadre el monto con la transferencia
   * que va a hacer.
   */
  async previewPayout(
    params: { salesRepId: string; fromMonth?: string; toMonth?: string },
    caller: SalesCaller,
  ) {
    this.assertIsAdmin(caller);

    const rep = await this.repository.findRepById(params.salesRepId);
    if (!rep) {
      throw new NotFoundException(
        `Vendedor con id=${params.salesRepId} no encontrado`,
      );
    }

    const commissions = await this.repository.findPayableCommissions({
      salesRepId: params.salesRepId,
      pendingStatusId: await this.statusIdByCode('pending'),
      fromMonth: params.fromMonth ?? null,
      toMonth: params.toMonth ?? null,
    });

    const totalAmount = commissions.reduce(
      (sum, c) => sum + c.commissionAmount,
      0,
    );
    return {
      salesRep: { id: rep.id, code: rep.code },
      fromMonth: params.fromMonth ?? null,
      toMonth: params.toMonth ?? null,
      count: commissions.length,
      totalAmount,
      currencyCode: commissions[0]?.currencyCode ?? 'COP',
      items: commissions.map((c) => ({
        id: c.id,
        accrualMonth: c.accrualMonth,
        accruedAt: c.accruedAt,
        companyName: c.company?.name ?? '—',
        kind: c.kind,
        commissionAmount: c.commissionAmount,
      })),
    };
  }

  /**
   * Referencia legible del comprobante: PAY-YYYYMM-NNNN. El correlativo se saca
   * de cuántos lotes lleva el mes; `reference` es @unique, así que un empate
   * (dos admins liquidando en el mismo instante) falla en vez de duplicar.
   */
  private async nextPayoutReference(): Promise<string> {
    const yearMonth = bogotaAccrualMonth(new Date()).replace('-', '');
    const count = await this.repository.countPayoutsInMonth(yearMonth);
    return `PAY-${yearMonth}-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Liquida de una vez todas las comisiones pendientes del vendedor en el rango.
   * Es una sola transferencia real, así que produce UN comprobante con su
   * referencia, y el correo al vendedor sale después (best-effort: si el correo
   * falla, la liquidación ya quedó hecha y el comprobante se puede reenviar).
   */
  async createPayout(dto: CreatePayoutDto, caller: SalesCaller) {
    this.assertIsAdmin(caller);

    const preview = await this.previewPayout(dto, caller);
    if (preview.count === 0) {
      throw new ConflictException(
        'No hay comisiones pendientes de este vendedor en el rango seleccionado',
      );
    }

    const payout = await this.repository.createPayout({
      reference: await this.nextPayoutReference(),
      salesRepId: dto.salesRepId,
      commissionIds: preview.items.map((i) => i.id),
      totalAmount: preview.totalAmount,
      currencyCode: preview.currencyCode,
      fromMonth: dto.fromMonth ?? null,
      toMonth: dto.toMonth ?? null,
      notes: dto.notes ?? null,
      paidBy: caller.platformAdminId,
      paidStatusId: await this.statusIdByCode('paid'),
      pendingStatusId: await this.statusIdByCode('pending'),
    });

    this.logger.log(
      `Liquidación ${payout.reference}: ${preview.count} comisión(es) por ` +
        `${preview.totalAmount} ${preview.currencyCode} a ${preview.salesRep.code} ` +
        `(por ${caller.name ?? caller.platformAdminId})`,
    );

    await this.sendPayoutReceipt(payout.id);
    return payout;
  }

  /**
   * Devuelve un giro completo: sus comisiones vuelven a pendiente y quedan
   * disponibles para liquidarse otra vez. El lote no se borra, se marca.
   */
  async revertPayout(id: string, reason: string, caller: SalesCaller) {
    this.assertIsAdmin(caller);

    const payout = await this.repository.findPayoutById(id);
    if (!payout) {
      throw new NotFoundException(`Liquidación con id=${id} no encontrada`);
    }
    if (payout.revertedAt) {
      throw new ConflictException(
        `La liquidación ${payout.reference} ya fue revertida el ` +
          `${payout.revertedAt.toLocaleDateString('es-CO')}`,
      );
    }

    const reverted = await this.repository.revertPayout({
      payoutId: id,
      pendingStatusId: await this.statusIdByCode('pending'),
      revertedBy: caller.platformAdminId,
      reason,
    });

    this.logger.log(
      `Liquidación ${payout.reference} revertida (${payout.commissionCount} ` +
        `comisión(es) vuelven a pendiente): ${reason}`,
    );
    return reverted;
  }

  async listPayouts(salesRepId: string | undefined, caller: SalesCaller) {
    // Un vendedor solo ve sus propios giros; el admin, todos.
    const scoped = this.scopeSalesRepId(caller, salesRepId);
    if (!caller.isAdmin && !scoped) return { data: [] };
    return { data: await this.repository.findPayouts(scoped) };
  }

  /** Formatea en pesos sin decimales, que es como se gira. */
  private money(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private shortDate(date: Date | null): string {
    return date
      ? date.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
      : '—';
  }

  /** Arma el view-model del comprobante a partir del lote y sus líneas. */
  private async buildReceiptView(payoutId: string) {
    const payout = await this.repository.findPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException(`Liquidación ${payoutId} no encontrada`);
    }

    const admin = payout.salesRep.platformAdmin;
    const fullName =
      [admin?.name, admin?.lastName].filter(Boolean).join(' ') ||
      payout.salesRep.code;
    const totalDiscounts = payout.commissions.reduce(
      (sum, c) => sum + c.discountFundedAmount,
      0,
    );
    const totalGross = payout.commissions.reduce(
      (sum, c) => sum + c.grossCommissionAmount,
      0,
    );

    const period =
      payout.fromMonth && payout.toMonth
        ? payout.fromMonth === payout.toMonth
          ? payout.fromMonth
          : `${payout.fromMonth} a ${payout.toMonth}`
        : (payout.toMonth ?? payout.fromMonth ?? 'Todo lo pendiente');

    return {
      payout,
      email: admin?.email ?? null,
      view: {
        reference: payout.reference,
        paidAt: this.shortDate(payout.paidAt),
        period,
        salesRepCode: payout.salesRep.code,
        salesRepName: fullName,
        salesRepEmail: admin?.email ?? '—',
        commissionCount: payout.commissionCount,
        totalAmount: this.money(payout.totalAmount),
        currencyCode: payout.currencyCode,
        notes: payout.notes,
        // Con descuentos financiados el comprobante muestra el desglose; sin
        // ellos esas columnas solo serían ruido.
        hasDiscounts: totalDiscounts > 0,
        totalDiscounts: this.money(totalDiscounts),
        totalGross: this.money(totalGross),
        lines: payout.commissions.map((c) => ({
          month: c.accrualMonth,
          date: this.shortDate(c.accruedAt),
          company: c.company?.name ?? '—',
          kind: c.kind === 'new' ? 'Cliente nuevo' : 'Recompra',
          base: this.money(c.baseAmount),
          gross: this.money(c.grossCommissionAmount),
          discount: this.money(c.discountFundedAmount),
          amount: this.money(c.commissionAmount),
        })),
      },
    };
  }

  /** PDF del comprobante, para descargar desde el panel o adjuntar al correo. */
  async buildPayoutReceiptPdf(payoutId: string) {
    const { payout, view } = await this.buildReceiptView(payoutId);
    const pdf = await this.pdfService.htmlToPdf(renderPayoutReceiptHtml(view), {
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
    return { pdf, filename: `${payout.reference}.pdf` };
  }

  /**
   * Le manda al vendedor su comprobante con el PDF adjunto.
   *
   * Best-effort a propósito: la plata ya se giró y la liquidación ya quedó
   * registrada, así que un fallo de correo (o de Gotenberg) no puede tumbarla.
   * Queda el log y el comprobante se puede reenviar desde el panel.
   */
  async sendPayoutReceipt(payoutId: string): Promise<boolean> {
    try {
      const { payout, view, email } = await this.buildReceiptView(payoutId);
      if (!email) {
        this.logger.warn(
          `Liquidación ${payout.reference}: el vendedor no tiene correo; no se envía comprobante`,
        );
        return false;
      }

      const pdf = await this.pdfService.htmlToPdf(
        renderPayoutReceiptHtml(view),
        {
          margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
        },
      );

      await this.mailService.sendCommissionPayoutEmail({
        to: email,
        salesRepName: view.salesRepName,
        reference: view.reference,
        period: view.period,
        commissionCount: view.commissionCount,
        totalAmount: view.totalAmount,
        notes: view.notes,
        attachment: { filename: `${payout.reference}.pdf`, content: pdf },
      });

      await this.repository.markReceiptSent(payoutId);
      this.logger.log(`Comprobante ${payout.reference} enviado a ${email}`);
      return true;
    } catch (e) {
      this.logger.error(
        `No se pudo enviar el comprobante de la liquidación ${payoutId}: ${
          (e as Error).message
        }`,
      );
      return false;
    }
  }

  async findPayout(id: string, caller: SalesCaller) {
    const payout = await this.repository.findPayoutById(id);
    if (!payout) {
      throw new NotFoundException(`Liquidación con id=${id} no encontrada`);
    }
    if (!caller.isAdmin && payout.salesRepId !== caller.salesRepId) {
      throw new ForbiddenException('Esta liquidación no es tuya');
    }
    return payout;
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
