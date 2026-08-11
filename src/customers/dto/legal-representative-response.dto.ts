import { ApiProperty } from '@nestjs/swagger';

class PersonTypeRefDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'legalEntity', nullable: true })
  code!: string | null;

  @ApiProperty({ example: 'PJ' })
  label!: string;
}

export class LegalRepresentativeResponseDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({ type: PersonTypeRefDto, description: "'PN' | 'PJ'" })
  personType!: PersonTypeRefDto;

  // ── Solo PJ: representante legal (columnas editables) ──
  @ApiProperty({ nullable: true, required: false })
  legalRepName?: string | null;

  @ApiProperty({ nullable: true, required: false })
  legalRepIdentificationTypeId?: number | null;

  @ApiProperty({ nullable: true, required: false })
  legalRepIdentificationNumber?: string | null;

  @ApiProperty({ nullable: true, required: false })
  legalRepEmail?: string | null;

  @ApiProperty({ nullable: true, required: false })
  legalRepPhone?: string | null;

  // ── Solo PN: el cliente firma por sí mismo ──
  @ApiProperty({ nullable: true, required: false })
  identificationTypeId?: number | null;

  @ApiProperty({ required: false })
  identificationNumber?: string;

  @ApiProperty({ nullable: true, required: false })
  firstName?: string | null;

  @ApiProperty({ nullable: true, required: false })
  secondName?: string | null;

  @ApiProperty({ nullable: true, required: false })
  firstLastName?: string | null;

  @ApiProperty({ nullable: true, required: false })
  secondLastName?: string | null;

  @ApiProperty({ nullable: true, required: false })
  email?: string | null;

  @ApiProperty({ nullable: true, required: false })
  phone?: string | null;
}
