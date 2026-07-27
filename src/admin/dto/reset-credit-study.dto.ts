import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// Reset de un estudio por soporte: el motivo es OBLIGATORIO porque es la
// justificación que queda en la auditoría (credit_study_resets), junto con el
// ticket de soporte (FK real a support_tickets) que lo originó.
export class ResetCreditStudyDto {
  @ApiProperty({
    description: 'Motivo del reset (queda en la auditoría)',
    example:
      'La extracción del PDF leyó el costo de ventas con signo negativo; prompt corregido, se habilita re-carga.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({
    description:
      'Id del ticket de soporte (support_tickets) que originó el reset. Debe pertenecer a la misma empresa del estudio.',
    example: '8d2f6b1a-3c4e-4f5a-9b0c-1d2e3f4a5b6c',
  })
  @IsOptional()
  @IsUUID()
  supportTicketId?: string;
}
