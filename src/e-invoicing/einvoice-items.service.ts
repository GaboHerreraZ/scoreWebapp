import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EInvoicingRepository } from './e-invoicing.repository.js';
import {
  E_INVOICE_PROVIDER,
  type IEInvoiceProvider,
} from './providers/e-invoice-provider.interface.js';
import {
  storedTaxRefs,
  toStoredTax,
  type ProviderItem,
  type ProviderItemInput,
} from './domain/billing-catalog.js';
import { DIAN_UNIT_MEASUREMENT_UNIT } from './domain/dian.catalogs.js';
import { toJson } from '../common/utils/prisma-json.util.js';
import type { CreateEInvoiceItemDto } from './dto/create-einvoice-item.dto.js';
import type { UpdateEInvoiceItemDto } from './dto/update-einvoice-item.dto.js';

/** Resultado de empujar un ítem al facturador. Nunca tumba la operación local. */
export interface ItemSyncOutcome {
  synced: boolean;
  /** Por qué no se pudo sincronizar. El panel lo muestra con el botón de reintentar. */
  error: string | null;
}

/**
 * Catálogo de ítems facturables.
 *
 * La tabla local es la FUENTE DE VERDAD de qué factura Creditia; el facturador
 * guarda una copia enlazada por `providerItemId`. Se separó del servicio de
 * emisión porque es otro ciclo de vida: los ítems se mantienen una vez y las
 * facturas se emiten todos los días.
 */
@Injectable()
export class EInvoiceItemsService {
  private readonly logger = new Logger(EInvoiceItemsService.name);

  constructor(
    private readonly repository: EInvoicingRepository,
    @Inject(E_INVOICE_PROVIDER)
    private readonly provider: IEInvoiceProvider,
  ) {}

  /** Catálogo local con su estado de sincronización y qué ofertas lo usan. */
  async list() {
    const items = await this.repository.listItems(this.provider.name);
    return items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description,
      unitMeasurementCode: item.unitMeasurementCode,
      priceSell: item.priceSell,
      taxRate: item.taxRate === null ? null : Number(item.taxRate),
      isActive: item.isActive,
      // Sin ref del facturador no se puede facturar con este ítem.
      isSynced: !!item.providerItemId,
      providerItemId: item.providerItemId,
      providerTaxes: item.providerTaxIds ?? [],
      // El formulario de edición los necesita para reenviarlos: editar REEMPLAZA
      // el producto en el facturador, y omitirlos lo dejaría sin categoría.
      providerCategoryRef: item.providerCategoryRef,
      providerMeasuringUnitRef: item.providerMeasuringUnitRef,
      providerSyncedAt: item.providerSyncedAt,
      offeringCount: item._count.packOfferings,
      offerings: item.packOfferings,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async findOne(id: string) {
    const item = await this.repository.findItemById(id);
    if (!item) throw new NotFoundException(`Ítem ${id} no encontrado`);
    return item;
  }

  async create(dto: CreateEInvoiceItemDto) {
    const existing = await this.repository.findItemByCode(dto.code);
    if (existing) {
      throw new ConflictException(
        `Ya existe un ítem con el código '${dto.code}'`,
      );
    }

    const created = await this.repository.createItem({
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      unitMeasurementCode:
        dto.unitMeasurementCode ?? DIAN_UNIT_MEASUREMENT_UNIT,
      priceSell: dto.priceSell ?? null,
      taxRate: dto.taxRate ?? null,
      isActive: dto.isActive ?? true,
      provider: this.provider.name,
      providerCategoryRef: dto.categoryRef ?? null,
      providerMeasuringUnitRef: dto.measuringUnitRef ?? null,
      providerTaxIds: toJson(
        (dto.taxRefs ?? []).map((ref) => ({ ref, name: null, rate: null })),
      ),
    });

    // La fila local ya existe: si el facturador falla, el ítem queda "sin
    // sincronizar" y se reintenta desde el panel. Nunca se deshace lo local.
    const sync =
      dto.sync === false
        ? { synced: false, error: 'Creado solo localmente (sync=false)' }
        : await this.trySync(created.id);

    return { id: created.id, code: created.code, sync };
  }

  async update(id: string, dto: UpdateEInvoiceItemDto) {
    const item = await this.findOne(id);

    await this.repository.updateItem(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.unitMeasurementCode !== undefined
        ? { unitMeasurementCode: dto.unitMeasurementCode }
        : {}),
      ...(dto.priceSell !== undefined ? { priceSell: dto.priceSell } : {}),
      ...(dto.taxRate !== undefined ? { taxRate: dto.taxRate } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.categoryRef !== undefined
        ? { providerCategoryRef: dto.categoryRef }
        : {}),
      ...(dto.measuringUnitRef !== undefined
        ? { providerMeasuringUnitRef: dto.measuringUnitRef }
        : {}),
      ...(dto.taxRefs !== undefined
        ? {
            providerTaxIds: toJson(
              dto.taxRefs.map((ref) => ({ ref, name: null, rate: null })),
            ),
          }
        : {}),
    });

    // Si nunca se sincronizó, editarlo lo crea allá: no tiene sentido dejar el
    // ítem editado y todavía sin poder facturar.
    const sync =
      dto.sync === false
        ? { synced: !!item.providerItemId, error: null }
        : await this.trySync(id);

    return { id, sync };
  }

  /**
   * Borra el ítem local y su copia en el facturador.
   *
   * Se niega si alguna oferta se factura con él: quitarlo dejaría esa oferta sin
   * poder emitirse, y el error aparecería recién al intentar facturar una venta
   * ya cobrada.
   */
  async remove(id: string) {
    const item = await this.findOne(id);

    const offerings = await this.repository.countOfferingsUsingItem(id);
    if (offerings > 0) {
      throw new ConflictException(
        `El ítem '${item.code}' se usa para facturar ${offerings} oferta(s) del catálogo. ` +
          'Repunta esas ofertas a otro ítem antes de borrarlo, o desactívalo.',
      );
    }

    if (item.providerItemId) {
      await this.provider.deleteItem(item.providerItemId);
    }
    await this.repository.deleteItem(id);

    this.logger.log(`Ítem facturable '${item.code}' (${id}) borrado`);
    return { id, deleted: true };
  }

  /**
   * Empuja el ítem al facturador y trae de vuelta sus ids de impuesto.
   *
   * Si allá ya existe un producto con el mismo código, lo ADOPTA en vez de
   * crear un duplicado: es lo que pasa cuando alguien lo creó a mano en el
   * portal antes de configurarlo aquí.
   */
  async sync(id: string) {
    const outcome = await this.trySync(id, { rethrow: true });
    return { id, sync: outcome };
  }

  private async trySync(
    id: string,
    options?: { rethrow?: boolean },
  ): Promise<ItemSyncOutcome> {
    try {
      await this.pushItem(id);
      return { synced: true, error: null };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`No se pudo sincronizar el ítem ${id}: ${message}`);
      if (options?.rethrow) throw error;
      return { synced: false, error: message };
    }
  }

  private async pushItem(id: string): Promise<void> {
    const item = await this.findOne(id);

    if (!item.providerCategoryRef || !item.providerMeasuringUnitRef) {
      throw new BadRequestException(
        'Falta la categoría o la unidad de medida del facturador: sin ellas no acepta el producto. ' +
          'Elígelas en el formulario del ítem.',
      );
    }

    const input: ProviderItemInput = {
      code: item.code,
      name: item.name,
      description: item.description,
      priceSell: item.priceSell,
      taxRefs: storedTaxRefs(item.providerTaxIds),
      categoryRef: item.providerCategoryRef,
      measuringUnitRef: item.providerMeasuringUnitRef,
    };

    let pushed: ProviderItem;
    if (item.providerItemId) {
      pushed = await this.provider.updateItem(item.providerItemId, input);
    } else {
      // Adoptar antes que duplicar: el código es la llave del producto allá.
      const existing = await this.provider.listItems({ code: item.code });
      const match = existing.find((candidate) => candidate.code === item.code);
      pushed = match
        ? await this.provider.updateItem(match.ref, input)
        : await this.provider.createItem(input);
    }

    await this.repository.updateItem(id, {
      providerItemId: pushed.ref,
      providerItemCode: pushed.code,
      // Solo se guardan los impuestos que el facturador confirmó. Si devuelve la
      // lista vacía se conserva lo pedido: perderla dejaría facturas sin IVA.
      ...(pushed.taxes.length > 0
        ? { providerTaxIds: toJson(pushed.taxes.map(toStoredTax)) }
        : {}),
      providerSyncedAt: new Date(),
    });

    this.logger.log(
      `Ítem facturable '${item.code}' sincronizado con ${this.provider.name} (${pushed.ref})`,
    );
  }

  /** Con qué ítem se factura una oferta del catálogo de bolsas. */
  async setOfferingItem(offeringId: string, itemId: string | null) {
    const offering = await this.repository.findOfferingById(offeringId);
    if (!offering) {
      throw new NotFoundException(`Oferta ${offeringId} no encontrada`);
    }

    if (itemId) {
      const item = await this.repository.findItemById(itemId);
      if (!item) throw new NotFoundException(`Ítem ${itemId} no encontrado`);
      if (!item.providerItemId) {
        throw new BadRequestException(
          `El ítem '${item.code}' todavía no está sincronizado con el facturador: no se puede facturar con él`,
        );
      }
    }

    return this.repository.setOfferingItem(offeringId, itemId);
  }

  // ── Catálogos de apoyo (alimentan los desplegables del formulario) ─────

  listProviderTaxes() {
    return this.provider.listTaxes();
  }

  listProviderCategories() {
    return this.provider.listItemCategories();
  }

  listProviderMeasuringUnits() {
    return this.provider.listMeasuringUnits();
  }

  listProviderBranches() {
    return this.provider.listBranches();
  }

  listProviderPaymentAccounts() {
    return this.provider.listPaymentAccounts();
  }
}
