import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({
    example: 'Bogotá D.C.',
    description: 'Ciudad de domicilio del titular ({{TITULAR_CIUDAD}})',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  titularCity?: string;

  @ApiPropertyOptional({
    example: 'Juan Pérez',
    description: 'PJ: nombre del representante legal (firmante)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalRepName?: string;

  @ApiPropertyOptional({
    example: 'cc',
    description: 'PJ: tipo de identificación del representante legal',
  })
  @IsOptional()
  @IsString()
  @IsIn(['cc', 'ce', 'pas', 'pa'])
  legalRepIdentificationTypeCode?: string;

  @ApiPropertyOptional({
    example: '79123456',
    description: 'PJ: número de identificación del representante legal',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepIdentificationNumber?: string;
}
