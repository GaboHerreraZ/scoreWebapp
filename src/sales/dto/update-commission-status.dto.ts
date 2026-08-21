import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Liquidación: marca una comisión como pagada, la devuelve a pendiente o la anula. */
export class UpdateCommissionStatusDto {
  @ApiProperty({
    description: 'Nuevo estado',
    enum: ['pending', 'paid', 'cancelled'],
    example: 'paid',
  })
  @IsIn(['pending', 'paid', 'cancelled'])
  status!: 'pending' | 'paid' | 'cancelled';

  @ApiPropertyOptional({
    description: 'Nota del pago (nº de transferencia, fecha del giro…)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  payoutNotes?: string;
}
