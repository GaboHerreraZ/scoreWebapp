import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// El Customer nace de la consulta, así que la entrada NO recibe customerId sino
// la identificación cruda a consultar. identificationTypeCode es el code del
// Parameter 'identification_type'; el servicio lo traduce al formato Experian.
export class ConsultCreditBureauDto {
  @ApiProperty({
    example: 'nit',
    description:
      "Código del tipo de identificación soportado por el buró: 'cc' | 'nit' | 'ce' | 'pas'",
  })
  @IsString()
  @IsIn(['cc', 'nit', 'ce', 'pas', 'pa'])
  identificationTypeCode: string;

  @ApiProperty({ example: '900123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  numeroIdentificacion: string;

  @ApiProperty({
    example: 'ACME SAS',
    description: 'Apellido (PN) o razón social (PJ) a validar',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  apellidoRazonSocial: string;
}
