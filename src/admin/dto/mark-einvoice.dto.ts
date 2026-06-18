import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkEinvoiceDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Estado de envío de la factura electrónica. true = enviada, false = pendiente. Por defecto true.',
  })
  @IsOptional()
  @IsBoolean()
  sent?: boolean;

  @ApiPropertyOptional({
    example: 'FE-1024',
    description: 'Número/folio de la factura electrónica emitida.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  einvoiceNumber?: string;
}
