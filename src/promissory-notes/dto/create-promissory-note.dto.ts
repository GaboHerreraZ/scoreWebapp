import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePromissoryNoteDto {
  @ApiProperty({
    example: 'b0c1a5f2-9f4b-4a1d-9b1e-1d7b2c4e0a12',
    description:
      'ID del estudio de crédito. El cliente, la empresa y el monto (a partir de requested_monthly_credit_line) se derivan de él.',
  })
  @IsUUID('4', {
    message: 'El campo creditStudyId debe ser un UUID válido.',
  })
  creditStudyId: string;
}
