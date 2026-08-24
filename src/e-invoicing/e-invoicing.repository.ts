import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class EInvoicingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Catálogo de ítems facturables ─────────────────────────────────────

  /** Todo el catálogo, con cuántas ofertas se facturan con cada ítem. */
  async listItems(provider: string) {
    return this.prisma.eInvoiceItem.findMany({
      where: { provider },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      include: {
        _count: { select: { packOfferings: true } },
        packOfferings: {
          select: { id: true, name: true, isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async findItemById(id: string) {
    return this.prisma.eInvoiceItem.findUnique({
      where: { id },
      include: { _count: { select: { packOfferings: true } } },
    });
  }

  async findItemByCode(code: string) {
    return this.prisma.eInvoiceItem.findUnique({ where: { code } });
  }

  async createItem(data: Prisma.EInvoiceItemUncheckedCreateInput) {
    return this.prisma.eInvoiceItem.create({ data });
  }

  async updateItem(id: string, data: Prisma.EInvoiceItemUncheckedUpdateInput) {
    return this.prisma.eInvoiceItem.update({ where: { id }, data });
  }

  async deleteItem(id: string) {
    return this.prisma.eInvoiceItem.delete({ where: { id } });
  }

  /** Ofertas del catálogo que se facturan con este ítem (bloquean el borrado). */
  async countOfferingsUsingItem(itemId: string): Promise<number> {
    return this.prisma.packOffering.count({
      where: { einvoiceItemId: itemId },
    });
  }

  /** Enlaza una oferta del catálogo con el ítem con el que se factura. */
  async setOfferingItem(offeringId: string, itemId: string | null) {
    return this.prisma.packOffering.update({
      where: { id: offeringId },
      data: { einvoiceItemId: itemId },
      select: { id: true, name: true, einvoiceItemId: true },
    });
  }

  async findOfferingById(id: string) {
    return this.prisma.packOffering.findUnique({
      where: { id },
      select: { id: true, name: true, einvoiceItemId: true },
    });
  }

  // ── Vínculo con el tercero del facturador ─────────────────────────────

  async findContactRef(provider: string, companyId: string) {
    return this.prisma.eInvoiceContactRef.findUnique({
      where: { provider_companyId: { provider, companyId } },
    });
  }

  /**
   * Guarda el vínculo. Es un upsert porque revincular es normal: la empresa pudo
   * cambiar de documento, o el financiero pudo elegir mal la primera vez.
   */
  async upsertContactRef(data: {
    provider: string;
    companyId: string;
    providerContactId: string;
    identification: string;
    displayName: string | null;
    linkedBy: string | null;
  }) {
    const { provider, companyId, ...rest } = data;
    return this.prisma.eInvoiceContactRef.upsert({
      where: { provider_companyId: { provider, companyId } },
      create: { provider, companyId, ...rest },
      update: { ...rest, linkedAt: new Date() },
    });
  }

  // ── Documentos ────────────────────────────────────────────────────────

  /**
   * La factura VIVA de una venta: la que no está anulada.
   *
   * findFirst y no findUnique porque el único de analysis_pack_id es PARCIAL
   * (vive en el SQL de la migración, Prisma no sabe declararlo). El filtro por
   * `voidedAt: null` es el mismo del índice: las anuladas se conservan como
   * histórico y no compiten por el lugar.
   */
  async findByAnalysisPack(analysisPackId: string) {
    return this.prisma.electronicInvoice.findFirst({
      where: { analysisPackId, voidedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { status: { select: { code: true, label: true } } },
    });
  }

  /** Histórico completo de una venta, anuladas incluidas. */
  async listByAnalysisPack(analysisPackId: string) {
    return this.prisma.electronicInvoice.findMany({
      where: { analysisPackId },
      orderBy: { createdAt: 'desc' },
      include: { status: { select: { code: true, label: true } } },
    });
  }

  async findById(id: string) {
    return this.prisma.electronicInvoice.findUnique({
      where: { id },
      include: { status: { select: { code: true, label: true } } },
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
        status: { select: { code: true } },
        packOffering: {
          select: {
            id: true,
            name: true,
            description: true,
            // Con qué ítem del catálogo facturable se emite esta oferta.
            einvoiceItem: true,
          },
        },
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

  /** Devuelve la venta a la cola de pendientes (factura anulada). */
  async unmarkPackInvoiced(analysisPackId: string) {
    return this.prisma.analysisPack.update({
      where: { id: analysisPackId },
      data: {
        einvoiceSent: false,
        einvoiceSentAt: null,
        einvoiceNumber: null,
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
