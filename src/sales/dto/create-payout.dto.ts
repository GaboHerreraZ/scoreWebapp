import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Liquida de una vez todas las comisiones pendientes de un vendedor en el rango
 * dado. Es UNA transferencia real, así que genera un solo comprobante.
 */
export class CreatePayoutDto {
  @ApiProperty({ description: 'Vendedor al que se le gira' })
  @IsUUID()
  salesRepId!: string;

  @ApiPropertyOptional({
    description: 'Desde qué mes de causación liquidar (YYYY-MM). Sin esto, desde el principio.',
    example: '2026-08',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'fromMonth debe tener formato YYYY-MM' })
  fromMonth?: string;

  @ApiPropertyOptional({
    description: 'Hasta qué mes de causación liquidar (YYYY-MM). Sin esto, hasta hoy.',
    example: '2026-08',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'toMonth debe tener formato YYYY-MM' })
  toMonth?: string;

  @ApiPropertyOptional({
    description: 'Referencia del giro (nº de transferencia, banco, fecha)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Devuelve un giro completo: sus comisiones vuelven a quedar pendientes. */
export class RevertPayoutDto {
  @ApiProperty({
    description: 'Por qué se devuelve (queda en el histórico del lote)',
    example: 'Transferencia rechazada por el banco',
  })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
