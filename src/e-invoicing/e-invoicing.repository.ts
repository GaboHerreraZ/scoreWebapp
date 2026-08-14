import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { InvoiceEnvironment } from './domain/invoice-document.js';

@Injectable()
export class EInvoicingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolución vigente del ambiente. null si no hay ninguna configurada. */
  async findActiveResolution(environment: InvoiceEnvironment) {
    return this.prisma.eInvoiceResolution.findFirst({
      where: { environment, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Reserva el siguiente consecutivo de forma ATÓMICA.
   *
   * Un solo UPDATE hace el claim: el `next_consecutive <= range_final` en el
   * WHERE impide pasarse del rango autorizado, y el RETURNING devuelve el
   * número que quedó tomado. Dos peticiones simultáneas se serializan en el
   * lock de fila de Postgres, así que jamás obtienen el mismo valor.
   *
   * Leer y luego escribir sería una condición de carrera, y el resultado sería
   * un consecutivo duplicado ante la DIAN — que solo se corrige con nota
   * crédito.
   *
   * @returns el consecutivo reservado, o null si el rango se agotó.
   */
  async reserveConsecutive(resolutionId: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ consecutive: number }[]>`
      UPDATE "einvoice_resolutions"
      SET "next_consecutive" = "next_consecutive" + 1,
          "updated_at" = NOW()
      WHERE "id" = ${resolutionId}::uuid
        AND "next_consecutive" <= "range_final"
      RETURNING "next_consecutive" - 1 AS "consecutive"
    `;
    return rows[0]?.consecutive ?? null;
  }

  /** Todas las resoluciones, con cuántas facturas las usaron. */
  async listResolutions() {
    return this.prisma.eInvoiceResolution.findMany({
      orderBy: [{ environment: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { invoices: true } } },
    });
  }

  async findResolutionById(id: string) {
    return this.prisma.eInvoiceResolution.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });
  }

  /**
   * Crea la resolución y, si nace activa, retira las demás del mismo ambiente
   * en la MISMA transacción: dos activas harían que `findActiveResolution`
   * eligiera por fecha de creación, que es una forma silenciosa de facturar con
   * el rango equivocado.
   */
  async createResolution(data: Prisma.EInvoiceResolutionUncheckedCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      if (data.isActive !== false) {
        await tx.eInvoiceResolution.updateMany({
          where: { environment: data.environment, isActive: true },
          data: { isActive: false },
        });
      }
      return tx.eInvoiceResolution.create({ data });
    });
  }

  /** Activa o retira una resolución. Activar retira las otras del ambiente. */
  async setResolutionActive(
    id: string,
    environment: string,
    isActive: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (isActive) {
        await tx.eInvoiceResolution.updateMany({
          where: { environment, isActive: true, id: { not: id } },
          data: { isActive: false },
        });
      }
      return tx.eInvoiceResolution.update({
        where: { id },
        data: { isActive },
      });
    });
  }

  async deleteResolution(id: string) {
    return this.prisma.eInvoiceResolution.delete({ where: { id } });
  }

  /** Cuántos números quedan en la resolución (para alertar antes de agotarla). */
  async remainingRange(resolutionId: string): Promise<number | null> {
    const resolution = await this.prisma.eInvoiceResolution.findUnique({
      where: { id: resolutionId },
      select: { rangeFinal: true, nextConsecutive: true },
    });
    if (!resolution) return null;
    return Math.max(0, resolution.rangeFinal - resolution.nextConsecutive + 1);
  }

  // ── Documentos ────────────────────────────────────────────────────────

  /** findFirst y no findUnique: el único de analysis_pack_id es PARCIAL (vive
   *  en el SQL de la migración, Prisma no sabe declararlo). */
  async findByAnalysisPack(analysisPackId: string) {
    return this.prisma.electronicInvoice.findFirst({
      where: { analysisPackId },
      include: { status: { select: { code: true, label: true } } },
    });
  }

  async findById(id: string) {
    return this.prisma.electronicInvoice.findUnique({
      where: { id },
      include: {
        status: { select: { code: true, label: true } },
        resolution: { select: { prefix: true } },
      },
    });
  }

  async create(data: Prisma.ElectronicInvoiceUncheckedCreateInput) {
    return this.prisma.electronicInvoice.create({ data });
  }

  async update(id: string, data: Prisma.ElectronicInvoiceUncheckedUpdateInput) {
    return this.prisma.electronicInvoice.update({ where: { id }, data });
  }

  /** Datos de la venta y del adquirente para armar el documento. */
  async findPackForInvoicing(analysisPackId: string) {
    return this.prisma.analysisPack.findUnique({
      where: { id: analysisPackId },
      select: {
        id: true,
        companyId: true,
        quantityPurchased: true,
        unitPricePaid: true,
        totalPaid: true,
        currencyCode: true,
        taxRatePaid: true,
        taxBase: true,
        taxAmount: true,
        paidAt: true,
        // Cómo pagó: determina el medio de pago DIAN de la factura.
        providerFranchise: true,
        isTest: true, // el preview avisa si el cobro fue de prueba
        packOffering: { select: { name: true, description: true } },
        status: { select: { code: true } },
        company: {
          select: {
            id: true,
            name: true,
            nit: true,
            billingName: true,
            billingLastName: true,
            billingBusinessName: true,
            billingDocNumber: true,
            billingEmail: true,
            billingPhone: true,
            billingAddress: true,
            billingCityCode: true,
            billingDocTypeId: true,
            billingRegimeTypeId: true,
            billingFiscalResponsibilities: true,
            billingDocType: { select: { code: true } },
            billingRegimeType: { select: { code: true } },
            billingDaneCity: {
              select: {
                code: true,
                dianName: true,
                regionCode: true,
                region: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  /** Marca la venta como facturada (denormalizado que alimenta la cola admin). */
  async markPackInvoiced(analysisPackId: string, number: string) {
    return this.prisma.analysisPack.update({
      where: { id: analysisPackId },
      data: {
        einvoiceSent: true,
        einvoiceSentAt: new Date(),
        einvoiceNumber: number,
      },
    });
  }

  /** id del Parameter 'einvoice_status' con ese code. */
  async findStatusId(code: string): Promise<number | null> {
    const param = await this.prisma.parameter.findFirst({
      where: { type: 'einvoice_status', code },
      select: { id: true },
    });
    return param?.id ?? null;
  }
}
