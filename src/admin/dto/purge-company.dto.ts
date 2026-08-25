import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// El borrado es irreversible y cross-tenant: se exige teclear el NIT de la
// empresa para que un id pegado por error no arrase con la empresa equivocada.
// Si la empresa aún no tiene NIT (onboarding diferido), se teclea la razón
// social exacta.
export class PurgeCompanyDto {
  @ApiProperty({
    description:
      'Confirmación del borrado: el NIT exacto de la empresa, o su razón social si aún no registró el NIT.',
    example: '900123456',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  confirmNit: string;
}
