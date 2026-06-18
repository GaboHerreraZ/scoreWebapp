import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Confirmación POST de ePayco para la compra de un pack (checkout onepage).
 * x_extra1 trae el id del AnalysisPack (lo enviamos al abrir el checkout).
 */
export class PackConfirmationDto {
  @ApiPropertyOptional({ description: 'ePayco reference payment ID' })
  @IsOptional()
  @IsString()
  x_ref_payco?: string;

  @ApiPropertyOptional({ description: 'Transaction ID' })
  @IsOptional()
  @IsString()
  x_transaction_id?: string;

  @ApiPropertyOptional({ description: 'Amount of the transaction' })
  @IsOptional()
  @IsString()
  x_amount?: string;

  @ApiPropertyOptional({ description: 'Currency code' })
  @IsOptional()
  @IsString()
  x_currency_code?: string;

  @ApiPropertyOptional({ description: 'Signature for validation' })
  @IsOptional()
  @IsString()
  x_signature?: string;

  @ApiPropertyOptional({
    description: 'Response code: 1=Accepted, 2=Rejected, 3=Pending, 4=Failed',
  })
  @IsOptional()
  @IsString()
  x_cod_response?: string;

  @ApiPropertyOptional({ description: 'Response description' })
  @IsOptional()
  @IsString()
  x_response?: string;

  @ApiPropertyOptional({ description: 'Approval code' })
  @IsOptional()
  @IsString()
  x_approval_code?: string;

  @ApiPropertyOptional({ description: 'Franchise (VISA, MC, etc.)' })
  @IsOptional()
  @IsString()
  x_franchise?: string;

  @ApiPropertyOptional({ description: 'Tarjeta enmascarada (457562***0326)' })
  @IsOptional()
  @IsString()
  x_cardnumber?: string;

  @ApiPropertyOptional({ description: 'Fecha/hora real del cobro' })
  @IsOptional()
  @IsString()
  x_transaction_date?: string;

  @ApiPropertyOptional({ description: 'Motivo detallado (00-Aprobada, etc.)' })
  @IsOptional()
  @IsString()
  x_response_reason_text?: string;

  @ApiPropertyOptional({ description: 'TRUE si es transacción de prueba' })
  @IsOptional()
  @IsString()
  x_test_request?: string;

  @ApiPropertyOptional({ description: 'Invoice / reference propia' })
  @IsOptional()
  @IsString()
  x_id_factura?: string;

  @ApiPropertyOptional({ description: 'Extra1 = AnalysisPack id' })
  @IsOptional()
  @IsString()
  x_extra1?: string;

  @ApiPropertyOptional({ description: 'Extra2' })
  @IsOptional()
  @IsString()
  x_extra2?: string;

  @ApiPropertyOptional({ description: 'Extra3' })
  @IsOptional()
  @IsString()
  x_extra3?: string;

  // ─── Resto de campos que ePayco incluye en la confirmación ───────────
  // Declarados para que el DTO refleje el payload completo. Se aceptan como
  // string (lo que ePayco envía vía form/query) y son opcionales.

  @ApiPropertyOptional({ description: 'p_cust_id_cliente del comercio' })
  @IsOptional()
  @IsString()
  x_cust_id_cliente?: string;

  @ApiPropertyOptional({ description: 'Invoice (alias de x_id_factura)' })
  @IsOptional()
  @IsString()
  x_id_invoice?: string;

  @ApiPropertyOptional({ description: 'Descripción de la compra' })
  @IsOptional()
  @IsString()
  x_description?: string;

  @ApiPropertyOptional({ description: 'Monto en moneda del país' })
  @IsOptional()
  @IsString()
  x_amount_country?: string;

  @ApiPropertyOptional({ description: 'Monto aprobado' })
  @IsOptional()
  @IsString()
  x_amount_ok?: string;

  @ApiPropertyOptional({ description: 'Impuesto' })
  @IsOptional()
  @IsString()
  x_tax?: string;

  @ApiPropertyOptional({ description: 'Base gravable' })
  @IsOptional()
  @IsString()
  x_amount_base?: string;

  @ApiPropertyOptional({ description: 'Banco emisor' })
  @IsOptional()
  @IsString()
  x_bank_name?: string;

  @ApiPropertyOptional({ description: 'Número de cuotas' })
  @IsOptional()
  @IsString()
  x_quotas?: string;

  @ApiPropertyOptional({ description: 'Respuesta (es)' })
  @IsOptional()
  @IsString()
  x_respuesta?: string;

  @ApiPropertyOptional({ description: 'Fecha de transacción (es)' })
  @IsOptional()
  @IsString()
  x_fecha_transaccion?: string;

  @ApiPropertyOptional({ description: 'Código de respuesta (es)' })
  @IsOptional()
  @IsString()
  x_cod_respuesta?: string;

  @ApiPropertyOptional({ description: 'Código de error' })
  @IsOptional()
  @IsString()
  x_errorcode?: string;

  @ApiPropertyOptional({ description: 'Código del estado de la transacción' })
  @IsOptional()
  @IsString()
  x_cod_transaction_state?: string;

  @ApiPropertyOptional({ description: 'Estado de la transacción' })
  @IsOptional()
  @IsString()
  x_transaction_state?: string;

  @ApiPropertyOptional({ description: 'Medio de pago' })
  @IsOptional()
  @IsString()
  x_payment_method?: string;

  @ApiPropertyOptional({ description: 'Razón social del comercio' })
  @IsOptional()
  @IsString()
  x_business?: string;

  @ApiPropertyOptional({ description: 'Tipo de documento del cliente' })
  @IsOptional()
  @IsString()
  x_customer_doctype?: string;

  @ApiPropertyOptional({ description: 'Documento del cliente' })
  @IsOptional()
  @IsString()
  x_customer_document?: string;

  @ApiPropertyOptional({ description: 'Nombre del cliente' })
  @IsOptional()
  @IsString()
  x_customer_name?: string;

  @ApiPropertyOptional({ description: 'Apellido del cliente' })
  @IsOptional()
  @IsString()
  x_customer_lastname?: string;

  @ApiPropertyOptional({ description: 'Email del cliente' })
  @IsOptional()
  @IsString()
  x_customer_email?: string;

  @ApiPropertyOptional({ description: 'Teléfono del cliente' })
  @IsOptional()
  @IsString()
  x_customer_phone?: string;

  @ApiPropertyOptional({ description: 'Móvil del cliente' })
  @IsOptional()
  @IsString()
  x_customer_movil?: string;

  @ApiPropertyOptional({ description: 'Indicativo país del cliente' })
  @IsOptional()
  @IsString()
  x_customer_ind_pais?: string;

  @ApiPropertyOptional({ description: 'País del cliente' })
  @IsOptional()
  @IsString()
  x_customer_country?: string;

  @ApiPropertyOptional({ description: 'Ciudad del cliente' })
  @IsOptional()
  @IsString()
  x_customer_city?: string;

  @ApiPropertyOptional({ description: 'Dirección del cliente' })
  @IsOptional()
  @IsString()
  x_customer_address?: string;

  @ApiPropertyOptional({ description: 'IP del cliente' })
  @IsOptional()
  @IsString()
  x_customer_ip?: string;

  @ApiPropertyOptional({ description: 'Extra4' })
  @IsOptional()
  @IsString()
  x_extra4?: string;

  @ApiPropertyOptional({ description: 'Extra5' })
  @IsOptional()
  @IsString()
  x_extra5?: string;

  @ApiPropertyOptional({ description: 'Extra6' })
  @IsOptional()
  @IsString()
  x_extra6?: string;

  @ApiPropertyOptional({ description: 'Extra7' })
  @IsOptional()
  @IsString()
  x_extra7?: string;

  @ApiPropertyOptional({ description: 'Extra8' })
  @IsOptional()
  @IsString()
  x_extra8?: string;

  @ApiPropertyOptional({ description: 'Extra9' })
  @IsOptional()
  @IsString()
  x_extra9?: string;

  @ApiPropertyOptional({ description: 'Extra10' })
  @IsOptional()
  @IsString()
  x_extra10?: string;

  @ApiPropertyOptional({ description: 'Impuesto ICO' })
  @IsOptional()
  @IsString()
  x_tax_ico?: string;

  @ApiPropertyOptional({ description: 'Fecha de pago' })
  @IsOptional()
  @IsString()
  x_payment_date?: string;

  @ApiPropertyOptional({ description: 'Ciclo de transacción' })
  @IsOptional()
  @IsString()
  x_transaction_cycle?: string;

  @ApiPropertyOptional({ description: 'Si es procesable' })
  @IsOptional()
  @IsString()
  is_processable?: string;

  @ApiPropertyOptional({ description: 'Pago múltiple' })
  @IsOptional()
  @IsString()
  x_multiple_payment?: string;
}
