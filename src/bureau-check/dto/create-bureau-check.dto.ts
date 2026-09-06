import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// Solo persona natural: el NIT no es un tipo válido aquí (el DTO lo corta
// antes de cualquier side-effect). El Customer nace de la consulta.
export class CreateBureauCheckDto {
  @ApiProperty({
    example: 'cc',
    description:
      "Tipo de identificación del titular (persona natural): 'cc' | 'ce' | 'pas' | 'pa'",
  })
  @IsString()
  @IsIn(['cc', 'ce', 'pas', 'pa'])
  identificationTypeCode: string;

  @ApiProperty({ example: '79123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  numeroIdentificacion: string;

  @ApiProperty({
    example: 'Pérez',
    description: 'Apellido del titular a validar contra la central',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  apellidoRazonSocial: string;

  // Firmante de la autorización de consulta (Ley 1266): mismo gate Zapsign de
  // los estudios. Requerido para poder enviarle el documento la primera vez.
  @ApiProperty({
    example: 'titular@correo.com',
    description: 'Correo del titular; firma la autorización de consulta',
  })
  @IsEmail()
  @MaxLength(255)
  titularEmail: string;

  @ApiPropertyOptional({
    example: 'Bogotá D.C.',
    description:
      'Ciudad de domicilio del titular; va en el documento de autorización',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  titularCity?: string;

  // Solo para el contraste contra el monto sugerido por la central; no hay
  // aprobación de cupo en este producto.
  @ApiPropertyOptional({
    example: 10000000,
    description: 'Monto que el titular solicita (referencia para el contraste)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  requestedCreditLine?: number;
}
