import { IsInt, IsNumber, IsPositive, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Emisión del pagaré de un estudio de crédito viable. Monto y plazo son
 * EDITABLES respecto a la solicitud del estudio: el monto no puede superar el
 * cupo solicitado (valida el service contra requestedCreditLine); el plazo en
 * días es libre. El resto de los datos del documento (deudor, acreedor, ciudad,
 * fechas) sale de Customer/Company — no viaja en el body.
 */
export class CreatePromissoryNoteDto {
  @ApiProperty({ description: 'ID del estudio de crédito viable' })
  @IsUUID()
  creditStudyId: string;

  @ApiProperty({
    example: 20500000,
    description:
      'Monto del pagaré en COP. Debe ser ≤ al cupo solicitado en el estudio.',
  })
  @IsNumber()
  @IsPositive()
  @Max(999_999_999_999)
  amount: number;

  @ApiProperty({
    example: 90,
    description: 'Plazo en días; el vencimiento es la fecha de emisión + plazo',
  })
  @IsInt()
  @Min(1)
  @Max(3650)
  termDays: number;
}
