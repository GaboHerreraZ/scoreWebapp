import { IsOptional, IsString, IsIn, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePaymentAlertDto {
  @ApiPropertyOptional({
    description: 'Nuevo estado de gestión (code)',
    example: 'in_progress',
    enum: ['open', 'in_progress', 'resolved'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['open', 'in_progress', 'resolved'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Notas de gestión del administrador',
    example: 'Se contactó al cliente, queda a la espera del nuevo pago.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
