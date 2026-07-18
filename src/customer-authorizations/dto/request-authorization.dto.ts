import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Datos internos para generar la autorización del titular (documento único:
 * tratamiento + habeas data + custodia). No es un body HTTP directo: lo arma
 * el service a partir de los datos del from-bureau (el nombre del titular sale
 * de `apellidoRazonSocial`). El correo es el firmante en Zapsign.
 */
export class RequestAuthorizationDto {
  @ApiProperty({
    example: 'nit',
    description:
      "Código del tipo de identificación: 'cc' | 'nit' | 'ce' | 'pas' | 'pa'",
  })
  @IsString()
  @IsIn(['cc', 'nit', 'ce', 'pas', 'pa'])
  identificationTypeCode: string;

  @ApiProperty({ example: '900123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  identificationNumber: string;

  @ApiProperty({
    example: 'ACME SAS',
    description: 'Nombre completo (PN) o razón social (PJ) del titular',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  titularName: string;

  @ApiProperty({
    example: 'representante@acme.com',
    description: 'Correo del titular; es el firmante del documento en Zapsign',
  })
  @IsEmail()
  @MaxLength(255)
  titularEmail: string;
}
