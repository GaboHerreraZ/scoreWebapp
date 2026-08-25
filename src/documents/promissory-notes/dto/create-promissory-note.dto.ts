import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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
 * Emisión del pagaré de un estudio de crédito viable. El pagaré se firma EN
 * BLANCO: no se pide monto ni plazo: el service los deriva del estudio como
 * referencia interna (no se imprimen en el documento). Los datos del firmante
 * pueden viajar en `signer`; el resto (acreedor, ciudad, fechas) sale de
 * Customer/Company.
 */
export class CreatePromissoryNoteDto {
  @ApiProperty({ description: 'ID del estudio de crédito viable' })
  @IsUUID()
  creditStudyId: string;

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
