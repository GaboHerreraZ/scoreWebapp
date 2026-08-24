import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// El borrado es irreversible y cross-tenant: se exige teclear el NIT de la
// empresa para que un id pegado por error no arrase con la empresa equivocada.
export class PurgeCompanyDto {
  @ApiProperty({
    description:
      'NIT de la empresa a eliminar. Debe coincidir exactamente con el registrado; es la confirmación del borrado.',
    example: '900123456',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  confirmNit: string;
}
