import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateEInvoiceItemDto } from './create-einvoice-item.dto.js';

/**
 * Edición de un ítem facturable.
 *
 * El `code` NO se puede cambiar: es la llave con la que el facturador identifica
 * al producto, y las facturas ya emitidas la llevan impresa. Para cambiarlo hay
 * que crear otro ítem y repuntar las ofertas.
 */
export class UpdateEInvoiceItemDto extends PartialType(
  OmitType(CreateEInvoiceItemDto, ['code'] as const),
) {}
