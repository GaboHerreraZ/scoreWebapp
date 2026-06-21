import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Consultas agregadas para las estadísticas del portal admin.
 *
 * Todas usan agregación en la BASE DE DATOS ($queryRaw con COUNT/SUM/GROUP BY/
 * date_trunc): Postgres reduce millones de filas a unas pocas y solo esas viajan
 * a Node. Nunca se traen filas crudas para contar en JS.
 *
 * Notas de tipos: COUNT/SUM de Postgres llegan como `bigint`/`Decimal`; el
 * service los normaliza con Number(). Aquí se devuelven tal cual los da el
 * driver. Las "ventas" se cuentan por paidAt IS NOT NULL (sello real del pago
 * confirmado), no por estado, para no depender de transiciones de estado.
 */
@Injectable()
export class AdminStatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Resumen (overview) ────────────────────────────────────────────────

  /** Ventas del periodo: créditos vendidos, ingresos, nº compras. */
  async salesSummary(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ credits_sold: bigint | null; revenue: number | null; purchases: bigint }>
    >`
      SELECT
        COALESCE(SUM(quantity_purchased), 0) AS credits_sold,
        COALESCE(SUM(total_paid), 0)         AS revenue,
        COUNT(*)                             AS purchases
      FROM analysis_packs
      WHERE paid_at IS NOT NULL
        AND paid_at >= ${from} AND paid_at < ${to}
    `;
    return rows[0];
  }

  /** Consultas consumidas en el periodo (uso real). */
  async consumptionCount(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ consumed: bigint }>>`
      SELECT COUNT(*) AS consumed
      FROM analysis_consumptions
      WHERE created_at >= ${from} AND created_at < ${to}
    `;
    return Number(rows[0]?.consumed ?? 0);
  }

  // ── Rankings ──────────────────────────────────────────────────────────

  /**
   * Top empresas por consumo en el periodo (las candidatas a promoción).
   * Devuelve la página pedida + el total de empresas con consumo (para paginar).
   */
  async topConsumers(from: Date, to: Date, skip: number, take: number) {
    const data = await this.prisma.$queryRaw<
      Array<{
        company_id: string;
        company_name: string;
        nit: string;
        consumptions: bigint;
      }>
    >`
      SELECT c.id AS company_id, c.name AS company_name, c.nit AS nit,
             COUNT(ac.id) AS consumptions
      FROM analysis_consumptions ac
      JOIN companies c ON c.id = ac.company_id
      WHERE ac.created_at >= ${from} AND ac.created_at < ${to}
      GROUP BY c.id, c.name, c.nit
      ORDER BY consumptions DESC, c.name ASC
      OFFSET ${skip} LIMIT ${take}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(DISTINCT ac.company_id) AS total
      FROM analysis_consumptions ac
      WHERE ac.created_at >= ${from} AND ac.created_at < ${to}
    `;
    return { data, total: Number(totalRows[0]?.total ?? 0) };
  }

  /**
   * Empresas que COMPRARON (paidAt) pero NO consumieron NADA en el periodo:
   * candidatas a churn. Ordenadas por créditos comprados desc (las que más
   * "dejaron parado"). Una empresa entra si tiene packs pagados y cero consumos
   * en la ventana.
   */
  async inactiveClients(from: Date, to: Date, skip: number, take: number) {
    const data = await this.prisma.$queryRaw<
      Array<{
        company_id: string;
        company_name: string;
        nit: string;
        credits_purchased: bigint;
        last_consumption_at: Date | null;
      }>
    >`
      SELECT c.id AS company_id, c.name AS company_name, c.nit AS nit,
             COALESCE(SUM(ap.quantity_purchased), 0) AS credits_purchased,
             (SELECT MAX(ac.created_at) FROM analysis_consumptions ac
                WHERE ac.company_id = c.id) AS last_consumption_at
      FROM analysis_packs ap
      JOIN companies c ON c.id = ap.company_id
      WHERE ap.paid_at IS NOT NULL
        AND ap.paid_at >= ${from} AND ap.paid_at < ${to}
        AND NOT EXISTS (
          SELECT 1 FROM analysis_consumptions ac
          WHERE ac.company_id = c.id
            AND ac.created_at >= ${from} AND ac.created_at < ${to}
        )
      GROUP BY c.id, c.name, c.nit
      ORDER BY credits_purchased DESC, c.name ASC
      OFFSET ${skip} LIMIT ${take}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) AS total FROM (
        SELECT c.id
        FROM analysis_packs ap
        JOIN companies c ON c.id = ap.company_id
        WHERE ap.paid_at IS NOT NULL
          AND ap.paid_at >= ${from} AND ap.paid_at < ${to}
          AND NOT EXISTS (
            SELECT 1 FROM analysis_consumptions ac
            WHERE ac.company_id = c.id
              AND ac.created_at >= ${from} AND ac.created_at < ${to}
          )
        GROUP BY c.id
      ) t
    `;
    return { data, total: Number(totalRows[0]?.total ?? 0) };
  }

  /**
   * Aprovechamiento por empresa: créditos comprados vs consumidos (sobre packs
   * pagados, todo el histórico de la empresa por defecto; acotable por fecha de
   * compra). Usa quantityConsumed denormalizado en el pack.
   */
  async utilization(from: Date, to: Date, skip: number, take: number) {
    const data = await this.prisma.$queryRaw<
      Array<{
        company_id: string;
        company_name: string;
        nit: string;
        credits_purchased: bigint;
        credits_consumed: bigint;
      }>
    >`
      SELECT c.id AS company_id, c.name AS company_name, c.nit AS nit,
             COALESCE(SUM(ap.quantity_purchased), 0) AS credits_purchased,
             COALESCE(SUM(ap.quantity_consumed), 0)  AS credits_consumed
      FROM analysis_packs ap
      JOIN companies c ON c.id = ap.company_id
      WHERE ap.paid_at IS NOT NULL
        AND ap.paid_at >= ${from} AND ap.paid_at < ${to}
      GROUP BY c.id, c.name, c.nit
      ORDER BY credits_purchased DESC, c.name ASC
      OFFSET ${skip} LIMIT ${take}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(DISTINCT ap.company_id) AS total
      FROM analysis_packs ap
      WHERE ap.paid_at IS NOT NULL
        AND ap.paid_at >= ${from} AND ap.paid_at < ${to}
    `;
    return { data, total: Number(totalRows[0]?.total ?? 0) };
  }

  // ── Saldo por vencer (liviano) ────────────────────────────────────────

  /**
   * Empresas con bolsas activas, vigentes y con saldo, ordenadas por la fecha de
   * vencimiento más próxima. Para avisar/renovar antes de que pierdan créditos.
   * windowEnd acota cuánto futuro mirar (ej. próximos 30 días).
   */
  async expiringCredits(
    activeStatusId: number,
    today: Date,
    windowEnd: Date,
    skip: number,
    take: number,
  ) {
    const data = await this.prisma.$queryRaw<
      Array<{
        company_id: string;
        company_name: string;
        nit: string;
        remaining: bigint;
        end_date: Date;
        pack_id: string;
      }>
    >`
      SELECT c.id AS company_id, c.name AS company_name, c.nit AS nit,
             (ap.quantity_purchased - ap.quantity_consumed) AS remaining,
             ap.end_date AS end_date, ap.id AS pack_id
      FROM analysis_packs ap
      JOIN companies c ON c.id = ap.company_id
      WHERE ap.status_id = ${activeStatusId}
        AND ap.end_date >= ${today} AND ap.end_date <= ${windowEnd}
        AND (ap.quantity_purchased - ap.quantity_consumed) > 0
      ORDER BY ap.end_date ASC
      OFFSET ${skip} LIMIT ${take}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) AS total
      FROM analysis_packs ap
      WHERE ap.status_id = ${activeStatusId}
        AND ap.end_date >= ${today} AND ap.end_date <= ${windowEnd}
        AND (ap.quantity_purchased - ap.quantity_consumed) > 0
    `;
    return { data, total: Number(totalRows[0]?.total ?? 0) };
  }

  // ── Tendencia mensual ─────────────────────────────────────────────────

  /** Consultas consumidas por mes en los últimos `months` meses. */
  async monthlyConsumption(months: number) {
    // make_interval(months => N) acepta el parámetro de forma segura (sin
    // concatenar strings). Tomamos desde el inicio del mes (months-1) atrás.
    return this.prisma.$queryRaw<Array<{ month: Date; consumed: bigint }>>`
      SELECT date_trunc('month', created_at) AS month, COUNT(*) AS consumed
      FROM analysis_consumptions
      WHERE created_at >= date_trunc('month', NOW()) - make_interval(months => ${months - 1})
      GROUP BY month
      ORDER BY month ASC
    `;
  }

  // ── Uso de códigos promocionales ──────────────────────────────────────

  /**
   * Canjes de códigos en el periodo, agrupados por código: cuántas veces se usó
   * y cuánto descuento total se otorgó. Paginado.
   */
  async promoUsage(from: Date, to: Date, skip: number, take: number) {
    const data = await this.prisma.$queryRaw<
      Array<{
        promo_code_id: string;
        code: string;
        scope_code: string;
        redemptions: bigint;
        total_discount: number | null;
      }>
    >`
      SELECT pc.id AS promo_code_id, pc.code AS code, sp.code AS scope_code,
             COUNT(r.id) AS redemptions,
             COALESCE(SUM(r.discount_amount), 0) AS total_discount
      FROM promo_code_redemptions r
      JOIN promo_codes pc ON pc.id = r.promo_code_id
      JOIN parameters sp ON sp.id = pc.scope_id
      WHERE r.redeemed_at >= ${from} AND r.redeemed_at < ${to}
      GROUP BY pc.id, pc.code, sp.code
      ORDER BY redemptions DESC, pc.code ASC
      OFFSET ${skip} LIMIT ${take}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(DISTINCT r.promo_code_id) AS total
      FROM promo_code_redemptions r
      WHERE r.redeemed_at >= ${from} AND r.redeemed_at < ${to}
    `;
    return { data, total: Number(totalRows[0]?.total ?? 0) };
  }

  /** Parameter por type+code (resolver activeStatusId para expiring). */
  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }
}
