import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkEinvoiceDto {
  @ApiProperty({
    description:
      'Número/folio de la factura electrónica emitida por el proveedor de FE',
    example: 'FE-1042',
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  einvoiceNumber: string;
}
