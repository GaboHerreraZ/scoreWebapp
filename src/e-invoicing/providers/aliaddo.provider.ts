import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AliaddoClient } from '../aliaddo/aliaddo.client.js';
import {
  fromAliaddoAccount,
  fromAliaddoBranch,
  fromAliaddoCategory,
  fromAliaddoInvoice,
  fromAliaddoItem,
  fromAliaddoMeasuringUnit,
  fromAliaddoPerson,
  fromAliaddoTax,
  fromAliaddoVoid,
  toAliaddoInvoice,
  toAliaddoItem,
  toAliaddoPerson,
} from '../aliaddo/aliaddo.mapper.js';
import {
  ALIADDO_IDENTIFICATION_TYPES,
  toAliaddoPersonKind,
} from '../aliaddo/aliaddo.catalogs.js';
import type {
  AliaddoBranch,
  AliaddoChartAccount,
  AliaddoCreatedRef,
  AliaddoItem,
  AliaddoItemCategory,
  AliaddoMeasuringUnit,
  AliaddoPerson,
  AliaddoTax,
} from '../aliaddo/aliaddo.types.js';
import type {
  BillingContact,
  ContactQuery,
  ProviderAccount,
  ProviderBranch,
  ProviderItem,
  ProviderItemInput,
  ProviderOption,
  ProviderTax,
} from '../domain/billing-catalog.js';
import type {
  InvoiceDocument,
  InvoiceEnvironment,
  InvoiceParty,
} from '../domain/invoice-document.js';
import type { IEInvoiceProvider } from './e-invoice-provider.interface.js';
import type { EInvoiceResult } from './e-invoice-result.js';

/** Tope de página de Aliaddo. Los catálogos son cortos: cabe todo en una. */
const MAX_ITEMS_PER_PAGE = '50';

/** La sucursal por defecto casi no cambia; reconsultarla en cada emisión sobra. */
const BRANCH_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Adaptador de Aliaddo (API contable: nitro.aliaddo.net).
 *
 * Solo orquesta client + mapper. No decide nada de negocio: si la DIAN rechaza,
 * lo devuelve como resultado y es el service quien resuelve qué hacer.
 */
@Injectable()
export class AliaddoProvider implements IEInvoiceProvider {
  readonly name = 'aliaddo';
  private readonly logger = new Logger(AliaddoProvider.name);

  private branchCache: { ref: string | null; at: number } | null = null;

  constructor(private readonly client: AliaddoClient) {}

  get environment(): InvoiceEnvironment {
    return this.client.environment;
  }

  // ── Documentos ──────────────────────────────────────────────────────────

  async issueInvoice(doc: InvoiceDocument): Promise<EInvoiceResult> {
    const payload = toAliaddoInvoice(doc);
    const { httpStatus, raw } = await this.client.post('/invoices', payload);
    const result = fromAliaddoInvoice(httpStatus, raw);

    this.logger.log(
      `Factura ${result.number ?? '(sin consecutivo)'} → ${result.status} ` +
        `(HTTP ${httpStatus}${result.cufe ? `, CUFE ${result.cufe.slice(0, 12)}…` : ''})`,
    );

    return result;
  }

  async getInvoice(externalId: string): Promise<EInvoiceResult> {
    const { httpStatus, raw } = await this.client.get(
      `/invoices/${encodeURIComponent(externalId)}`,
    );
    return fromAliaddoInvoice(httpStatus, raw);
  }

  async voidInvoice(
    externalId: string,
    options?: { paymentAccountCode?: string | null },
  ): Promise<EInvoiceResult> {
    // accountCode es obligatorio si la factura estaba pagada — que es el caso
    // normal aquí: se emiten ya cobradas.
    const { httpStatus, raw } = await this.client.patch(
      `/invoices/${encodeURIComponent(externalId)}/void`,
      { accountCode: options?.paymentAccountCode ?? undefined },
    );
    return fromAliaddoVoid(httpStatus, raw, externalId);
  }

  // ── Terceros ────────────────────────────────────────────────────────────

  /**
   * Busca en el directorio. `kind` tiene default 'Person' en Aliaddo, así que
   * cuando no se sabe si el tercero está como persona o como empresa hay que
   * preguntar por los dos y unir: buscar solo por identificación devolvería
   * únicamente las personas naturales.
   */
  async findContacts(query: ContactQuery): Promise<BillingContact[]> {
    const kinds =
      query.isLegalEntity == null
        ? ([true, false] as const)
        : ([query.isLegalEntity] as const);

    const pages = await Promise.all(
      kinds.map((isLegalEntity) =>
        this.client.get('/people', {
          kind: toAliaddoPersonKind(isLegalEntity),
          identification: query.identification,
          email: query.email,
          phoneNumber: query.phone,
          itemsPerPage: MAX_ITEMS_PER_PAGE,
        }),
      ),
    );

    const found = pages.flatMap(({ raw }) => asArray<AliaddoPerson>(raw));
    // Preguntar por los dos `kind` puede traer el mismo tercero repetido.
    const unique = new Map(found.map((person) => [person.id, person]));
    return [...unique.values()].map(fromAliaddoPerson);
  }

  /**
   * Aliaddo acepta un SUBCONJUNTO del catálogo DIAN de identificaciones: no
   * están la tarjeta de identidad ('12') ni el PPT ('48'), que sí existen en
   * nuestro Parameter 'identification_type'.
   */
  supportsIdentificationType(dianCode: string): boolean {
    return ALIADDO_IDENTIFICATION_TYPES.has(dianCode);
  }

  async createContact(party: InvoiceParty): Promise<BillingContact> {
    if (!this.supportsIdentificationType(party.identificationTypeCode)) {
      throw new BadRequestException(
        `Aliaddo no admite el tipo de documento '${party.identificationTypeCode}' para dar de alta un tercero. ` +
          'Corrige el perfil fiscal de la empresa o crea el cliente a mano en el portal y vincúlalo.',
      );
    }

    const payload = toAliaddoPerson(party);
    const { httpStatus, raw, ok } = await this.client.post('/people', payload);

    if (!ok) {
      throw new BadRequestException(
        `El facturador rechazó el alta del cliente (HTTP ${httpStatus}): ${describe(raw)}`,
      );
    }

    const created = raw as AliaddoCreatedRef;
    this.logger.log(
      `Cliente ${party.identificationNumber} dado de alta en Aliaddo (${created.id})`,
    );

    return {
      ref: created.id,
      displayName: created.name ?? party.legalName,
      identificationTypeCode: party.identificationTypeCode,
      identificationNumber: party.identificationNumber,
      isLegalEntity: payload.kind === 'Company',
      isCustomer: true,
      email: party.email,
      phone: party.phone,
    };
  }

  // ── Catálogo de productos ───────────────────────────────────────────────

  async listItems(query?: { code?: string }): Promise<ProviderItem[]> {
    const { raw } = await this.client.get('/items', {
      code: query?.code,
      itemsPerPage: MAX_ITEMS_PER_PAGE,
    });
    return asArray<AliaddoItem>(raw).map(fromAliaddoItem);
  }

  async createItem(input: ProviderItemInput): Promise<ProviderItem> {
    const { httpStatus, raw, ok } = await this.client.post(
      '/items',
      toAliaddoItem(input),
    );
    if (!ok) {
      throw new BadRequestException(
        `El facturador rechazó la creación del producto (HTTP ${httpStatus}): ${describe(raw)}`,
      );
    }
    return this.reloadItem((raw as AliaddoCreatedRef).id, input);
  }

  async updateItem(
    externalId: string,
    input: ProviderItemInput,
  ): Promise<ProviderItem> {
    const { httpStatus, raw, ok } = await this.client.put(
      `/items/${encodeURIComponent(externalId)}`,
      toAliaddoItem(input),
    );
    if (!ok) {
      throw new BadRequestException(
        `El facturador rechazó la edición del producto (HTTP ${httpStatus}): ${describe(raw)}`,
      );
    }
    return this.reloadItem(externalId, input);
  }

  async deleteItem(externalId: string): Promise<void> {
    const { httpStatus, raw, ok } = await this.client.delete(
      `/items/${encodeURIComponent(externalId)}`,
    );
    if (!ok) {
      throw new BadRequestException(
        `El facturador no pudo borrar el producto (HTTP ${httpStatus}): ${describe(raw)}`,
      );
    }
  }

  /**
   * Crear y editar responden solo `{id, name}`. Se relee por código para
   * devolver el producto COMPLETO — sobre todo los ids de impuesto, que son los
   * que después viajan en cada línea de factura.
   */
  private async reloadItem(
    externalId: string,
    input: ProviderItemInput,
  ): Promise<ProviderItem> {
    const items = await this.listItems({ code: input.code });
    const match = items.find((item) => item.ref === externalId);
    if (match) return match;

    // La relectura es una comodidad, no un requisito: si el facturador todavía
    // no lo indexa, se devuelve lo que se pidió crear.
    return {
      ref: externalId,
      code: input.code,
      name: input.name,
      description: input.description,
      priceSell: input.priceSell,
      taxes: [],
    };
  }

  // ── Catálogos de apoyo ──────────────────────────────────────────────────

  async listTaxes(): Promise<ProviderTax[]> {
    const { raw } = await this.client.get('/taxes', {
      itemPerPage: MAX_ITEMS_PER_PAGE, // sic: este endpoint lo escribe en singular
    });
    return asArray<AliaddoTax>(raw).map(fromAliaddoTax);
  }

  async listItemCategories(): Promise<ProviderOption[]> {
    const { raw } = await this.client.get('/item-categories');
    return asArray<AliaddoItemCategory>(raw).map(fromAliaddoCategory);
  }

  async listMeasuringUnits(): Promise<ProviderOption[]> {
    const { raw } = await this.client.get('/measuring-units');
    return asArray<AliaddoMeasuringUnit>(raw).map(fromAliaddoMeasuringUnit);
  }

  async listBranches(): Promise<ProviderBranch[]> {
    const { raw } = await this.client.get('/branches');
    return asArray<AliaddoBranch>(raw).map(fromAliaddoBranch);
  }

  async listPaymentAccounts(): Promise<ProviderAccount[]> {
    const { raw } = await this.client.get('/chart-accounts', {
      itemPerPage: MAX_ITEMS_PER_PAGE,
    });
    return asArray<AliaddoChartAccount>(raw)
      .filter((account) => !!account.code)
      .map(fromAliaddoAccount);
  }

  /**
   * Sucursal con la que se emite: la configurada a mano gana, y si no hay, la
   * que Aliaddo marque por defecto entre las habilitadas.
   */
  async resolveDefaultBranchRef(): Promise<string | null> {
    if (this.client.configuredBranchId) return this.client.configuredBranchId;

    const cached = this.branchCache;
    if (cached && Date.now() - cached.at < BRANCH_CACHE_TTL_MS) {
      return cached.ref;
    }

    const branches = await this.listBranches();
    const enabled = branches.filter((branch) => branch.isEnabled);
    const ref =
      (enabled.find((branch) => branch.isDefault) ?? enabled[0])?.ref ?? null;

    this.branchCache = { ref, at: Date.now() };
    return ref;
  }
}

/** Los listados de Aliaddo devuelven un arreglo; un error, un objeto vacío. */
function asArray<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/** Texto legible del cuerpo de un error, para el mensaje que ve el admin. */
function describe(raw: unknown): string {
  if (!raw) return 'sin detalle';
  if (typeof raw === 'string') return raw;
  const body = raw as { message?: unknown; errors?: unknown };
  if (typeof body.message === 'string') return body.message;
  return JSON.stringify(raw).slice(0, 300);
}
