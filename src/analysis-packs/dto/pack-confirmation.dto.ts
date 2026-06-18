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
}
