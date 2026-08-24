import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Anulación de una factura ya emitida. El motivo es obligatorio: anular es un
 * acto contable y años después alguien va a preguntar por qué.
 */
export class VoidInvoiceDto {
  @ApiProperty({
    description: 'Por qué se anula',
    example: 'Datos fiscales del adquirente incorrectos',
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
