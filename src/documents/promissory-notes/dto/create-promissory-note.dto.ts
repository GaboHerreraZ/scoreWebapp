import {
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Datos del firmante, prellenados por el front con
 * GET .../customers/:id/legal-representative y editables antes de emitir.
 * PJ usa los legalRep*; PN los de identidad propia. Lo que no venga en el
 * body cae a las columnas del Customer.
 */
export class PromissoryNoteSignerDto {
  // ── Solo PJ: representante legal ──
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalRepName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  legalRepIdentificationTypeId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepIdentificationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  legalRepEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepPhone?: string;

  // ── Solo PN: el cliente firma en nombre propio ──
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  identificationTypeId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  identificationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  secondName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  firstLastName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  secondLastName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

/**
 * Emisión del pagaré de un estudio de crédito viable. Monto y plazo son
 * EDITABLES respecto a la solicitud del estudio: el monto no puede superar el
 * cupo solicitado (valida el service contra requestedCreditLine); el plazo en
 * días es libre. Los datos del firmante pueden viajar en `signer`; el resto
 * (acreedor, ciudad, fechas) sale de Customer/Company.
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

  @ApiProperty({
    required: false,
    type: PromissoryNoteSignerDto,
    description:
      'Datos del firmante (rep. legal en PJ, el propio cliente en PN); si se omiten, se usan los del Customer',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PromissoryNoteSignerDto)
  signer?: PromissoryNoteSignerDto;
}
