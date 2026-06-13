import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class EpaycoConfirmationDto {
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

  @ApiPropertyOptional({ description: 'Customer document type' })
  @IsOptional()
  @IsString()
  x_customer_doctype?: string;

  @ApiPropertyOptional({ description: 'Customer document number' })
  @IsOptional()
  @IsString()
  x_customer_document?: string;

  @ApiPropertyOptional({ description: 'Customer email' })
  @IsOptional()
  @IsString()
  x_customer_email?: string;

  @ApiPropertyOptional({ description: 'Customer name' })
  @IsOptional()
  @IsString()
  x_customer_name?: string;

  @ApiPropertyOptional({ description: 'Invoice ID' })
  @IsOptional()
  @IsString()
  x_id_factura?: string;

  @ApiPropertyOptional({ description: 'Extra1 field' })
  @IsOptional()
  @IsString()
  x_extra1?: string;

  @ApiPropertyOptional({ description: 'Extra2 field' })
  @IsOptional()
  @IsString()
  x_extra2?: string;

  @ApiPropertyOptional({ description: 'Extra3 field' })
  @IsOptional()
  @IsString()
  x_extra3?: string;
}
