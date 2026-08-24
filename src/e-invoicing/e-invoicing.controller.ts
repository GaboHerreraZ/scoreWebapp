import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { EInvoicingService } from './e-invoicing.service.js';
import { EInvoiceItemsService } from './einvoice-items.service.js';
import { CreateEInvoiceItemDto } from './dto/create-einvoice-item.dto.js';
import { UpdateEInvoiceItemDto } from './dto/update-einvoice-item.dto.js';
import { FindContactsDto } from './dto/find-contacts.dto.js';
import { LinkContactDto } from './dto/link-contact.dto.js';
import { SetOfferingItemDto } from './dto/set-offering-item.dto.js';
import { VoidInvoiceDto } from './dto/void-invoice.dto.js';

/**
 * Panel de facturación electrónica.
 *
 * Vive aquí y no en `admin.controller.ts` porque son 17 rutas de un dominio
 * propio. En admin se quedan la COLA de ventas por facturar y la marca manual,
 * que son consultas sobre `analysis_packs`, no sobre documentos fiscales.
 *
 * Ninguna ruta nombra al proveedor: el panel habla de "el facturador".
 */
@ApiTags('Admin · Facturación electrónica')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/einvoices')
export class EInvoicingController {
  constructor(
    private readonly eInvoicingService: EInvoicingService,
    private readonly itemsService: EInvoiceItemsService,
  ) {}

  // ── Configuración y catálogos del facturador ──────────────────────────

  @Get('config')
  @ApiOperation({
    summary: 'Cómo está configurado el servidor para facturar',
    description:
      'Proveedor, ambiente declarado, kill switch y cuenta de recaudo. OJO: el ambiente real lo determina la cuenta del facturador a la que pertenece el token, no esta etiqueta.',
  })
  getConfig() {
    return this.eInvoicingService.getConfig();
  }

  @Get('taxes')
  @ApiOperation({
    summary: 'Impuestos configurados en el facturador',
    description:
      'Alimenta el selector del formulario de ítems. El `ref` de cada uno es lo que después viaja en cada línea de factura.',
  })
  listTaxes() {
    return this.itemsService.listProviderTaxes();
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categorías de producto del facturador' })
  listCategories() {
    return this.itemsService.listProviderCategories();
  }

  @Get('measuring-units')
  @ApiOperation({ summary: 'Unidades de medida del facturador' })
  listMeasuringUnits() {
    return this.itemsService.listProviderMeasuringUnits();
  }

  @Get('branches')
  @ApiOperation({
    summary: 'Sucursales del facturador',
    description:
      'La emisión usa la marcada por defecto, o la fijada en ALIADDO_BRANCH_ID.',
  })
  listBranches() {
    return this.itemsService.listProviderBranches();
  }

  @Get('accounts')
  @ApiOperation({
    summary: 'Cuentas contables del facturador (bancos/caja)',
    description:
      'De aquí sale el código para EINVOICE_PAYMENT_ACCOUNT_CODE, que hace que la factura nazca pagada en vez de quedar como cartera abierta.',
  })
  listPaymentAccounts() {
    return this.itemsService.listProviderPaymentAccounts();
  }

  // ── Catálogo de ítems facturables ─────────────────────────────────────

  @Get('items')
  @ApiOperation({
    summary: 'Catálogo de ítems facturables',
    description:
      'El catálogo es nuestro; el facturador guarda una copia. `isSynced=false` significa que todavía no se puede facturar con ese ítem.',
  })
  listItems() {
    return this.itemsService.list();
  }

  @Post('items')
  @ApiOperation({
    summary: 'Crear un ítem facturable',
    description:
      'Crea la fila local y empuja la copia al facturador. Si el empuje falla, el ítem queda creado y sin sincronizar (`sync.synced=false`): se reintenta con /sync.',
  })
  @ApiResponse({ status: 409, description: 'Ya existe un ítem con ese código' })
  createItem(@Body() dto: CreateEInvoiceItemDto) {
    return this.itemsService.create(dto);
  }

  @Put('items/:id')
  @ApiOperation({
    summary: 'Editar un ítem facturable',
    description:
      'El código no se puede cambiar: es la llave con la que el facturador identifica al producto y va impresa en las facturas ya emitidas.',
  })
  @ApiResponse({ status: 404, description: 'Ítem no encontrado' })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEInvoiceItemDto,
  ) {
    return this.itemsService.update(id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({
    summary: 'Borrar un ítem facturable',
    description:
      'Se niega si alguna oferta del catálogo se factura con él: quitarlo dejaría esa oferta sin poder emitirse.',
  })
  @ApiResponse({
    status: 409,
    description: 'Hay ofertas que se facturan con este ítem',
  })
  removeItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemsService.remove(id);
  }

  @Post('items/:id/sync')
  @ApiOperation({
    summary: 'Sincronizar el ítem con el facturador',
    description:
      'Si allá ya hay un producto con el mismo código lo ADOPTA en vez de duplicarlo. Devuelve además los ids de impuesto, que son los que viajan en cada línea.',
  })
  syncItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemsService.sync(id);
  }

  @Patch('offerings/:offeringId/item')
  @ApiOperation({
    summary: 'Con qué ítem se factura una oferta del catálogo de bolsas',
    description:
      'Sin ítem asociado, la venta de esa oferta no se puede facturar. Solo admite ítems ya sincronizados.',
  })
  @ApiResponse({ status: 404, description: 'Oferta o ítem no encontrado' })
  setOfferingItem(
    @Param('offeringId', ParseUUIDPipe) offeringId: string,
    @Body() dto: SetOfferingItemDto,
  ) {
    return this.itemsService.setOfferingItem(
      offeringId,
      dto.einvoiceItemId ?? null,
    );
  }

  // ── Directorio de terceros ────────────────────────────────────────────

  @Get('contacts')
  @ApiOperation({
    summary: 'Buscar clientes en el directorio del facturador',
    description:
      'Filtra por documento, correo o teléfono (coincidencia parcial). NO hay búsqueda por nombre: el facturador no la ofrece, y la llave real del tercero es su documento.',
  })
  @ApiResponse({
    status: 400,
    description: 'Hay que enviar al menos un criterio',
  })
  findContacts(@Query() dto: FindContactsDto) {
    return this.eInvoicingService.findContacts({
      identification: dto.identification,
      email: dto.email,
      phone: dto.phone,
      isLegalEntity:
        dto.isLegalEntity === undefined ? null : dto.isLegalEntity === 'true',
    });
  }

  // ── Flujo por venta ───────────────────────────────────────────────────

  @Get(':packId/contact')
  @ApiOperation({
    summary: 'Estado del cliente de una venta en el facturador',
    description:
      'Lo que alimenta el botón: `linked` ya está vinculado y se puede emitir; `found` existe y hay que elegir cuál; `not_found` hay que crearlo; `unsupported` el facturador no admite su tipo de documento; `unavailable` no se pudo consultar.',
  })
  @ApiResponse({ status: 404, description: 'Bolsa no encontrada' })
  resolveContact(@Param('packId', ParseUUIDPipe) packId: string) {
    return this.eInvoicingService.resolveContactForPack(packId);
  }

  @Post(':packId/contact')
  @ApiOperation({
    summary:
      'Crear el cliente en el facturador con el perfil fiscal de la empresa',
    description:
      'Lo da de alta como cliente y deja el vínculo guardado, así que la próxima compra de esa empresa ya no lo vuelve a buscar.',
  })
  @ApiResponse({
    status: 400,
    description: 'Perfil fiscal incompleto o tipo de documento no admitido',
  })
  createContact(
    @Param('packId', ParseUUIDPipe) packId: string,
    @Req() req: Request,
  ) {
    return this.eInvoicingService.createContactForPack(packId, userId(req));
  }

  @Post(':packId/contact/link')
  @ApiOperation({
    summary:
      'Vincular la empresa con un cliente que ya existe en el facturador',
    description:
      'Se confirma contra el facturador que el tercero elegido corresponde al documento de la empresa: vincular otro facturaría a nombre equivocado.',
  })
  @ApiResponse({
    status: 400,
    description: 'El tercero no corresponde al documento de la empresa',
  })
  linkContact(
    @Param('packId', ParseUUIDPipe) packId: string,
    @Body() dto: LinkContactDto,
    @Req() req: Request,
  ) {
    return this.eInvoicingService.linkContactForPack(
      packId,
      dto.contactRef,
      userId(req),
    );
  }

  @Get(':packId/preview')
  @ApiOperation({
    summary: 'Ver qué se va a facturar, antes de emitir',
    description:
      'Arma el documento con el MISMO código que la emisión, así que lo que se muestra es lo que se envía. En vez de fallar por datos incompletos los devuelve en `blockers` (canIssue=false); `warnings` trae lo que no impide emitir pero conviene revisar. El número de la factura no se conoce de antemano: lo asigna el facturador.',
  })
  @ApiResponse({ status: 404, description: 'Bolsa no encontrada' })
  preview(@Param('packId', ParseUUIDPipe) packId: string) {
    return this.eInvoicingService.previewForPack(packId);
  }

  @Get(':packId/documents')
  @ApiOperation({
    summary: 'Documentos emitidos para una venta, anulados incluidos',
    description:
      'El preview solo muestra la factura viva. Aquí está el histórico completo: cada anulada conserva su número, su CUFE, su PDF y el motivo por el que se anuló.',
  })
  listDocuments(@Param('packId', ParseUUIDPipe) packId: string) {
    return this.eInvoicingService.listDocumentsForPack(packId);
  }

  @Post(':packId/issue')
  @ApiOperation({
    summary: 'Emitir la factura electrónica de una venta (acción manual)',
    description:
      'Exige el cliente ya vinculado. Emite con el desglose CONGELADO al cobrar y contrasta el total que devuelve el facturador contra lo cobrado. Idempotente: si la venta ya tiene factura aceptada no la reemite; si tiene una rechazada, reintenta sobre el mismo documento.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Cliente sin vincular, ítem sin configurar o datos fiscales incompletos',
  })
  @ApiResponse({ status: 404, description: 'Bolsa no encontrada' })
  issue(@Param('packId', ParseUUIDPipe) packId: string) {
    return this.eInvoicingService.issueForPack(packId);
  }

  // ── Ciclo de vida del documento ───────────────────────────────────────

  @Post('documents/:invoiceId/refresh')
  @ApiOperation({
    summary: 'Reconsultar el estado de una factura ante la DIAN',
    description:
      'Para documentos que quedaron sin veredicto (enviados pero sin CUFE). Mismo shape que /issue.',
  })
  @ApiResponse({ status: 404, description: 'Factura no encontrada' })
  refresh(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.eInvoicingService.refreshStatus(invoiceId);
  }

  @Post('documents/:invoiceId/void')
  @ApiOperation({
    summary: 'Anular una factura emitida',
    description:
      'La factura NO se borra: conserva su CUFE, su PDF y queda con el motivo y quién la anuló. La venta vuelve a la cola de pendientes por facturar.',
  })
  @ApiResponse({
    status: 400,
    description: 'Ya anulada o nunca llegó al facturador',
  })
  @ApiResponse({ status: 404, description: 'Factura no encontrada' })
  void(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: VoidInvoiceDto,
    @Req() req: Request,
  ) {
    return this.eInvoicingService.voidInvoice(
      invoiceId,
      dto.reason,
      userId(req),
    );
  }
}

/** El AdminGuard ya garantizó que hay usuario autenticado. */
function userId(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}
