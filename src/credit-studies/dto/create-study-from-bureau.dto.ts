import { IntersectionType } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ConsultCreditBureauDto } from '../../credit-bureau/dto/consult-credit-bureau.dto.js';

// Datos de la solicitud del estudio + el correo del titular para la
// autorización (lo único que el usuario aporta; el resto del estudio queda null
// hasta que se realice). studyDate NO se pide: se setea a hoy al crear.
class StudyRequestDto {
  @ApiPropertyOptional({ example: 12, description: 'Plazo solicitado (meses)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requestedTerm?: number;

  @ApiPropertyOptional({ example: 50000000, description: 'Cupo solicitado' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  requestedCreditLine?: number;

  // Correo del titular = firmante de la autorización en Zapsign. Requerido: se
  // usa la 1ª vez para enviarle el documento; en re-consultas (ya firmado) o con
  // la firma pendiente el flujo lo ignora, pero el front siempre lo envía. El
  // nombre del titular en el documento sale de `apellidoRazonSocial`.
  // En PJ es el correo del representante legal → se persiste en Customer.legalRepEmail.
  @ApiProperty({
    example: 'titular@correo.com',
    description:
      'Correo del titular; es el firmante de la autorización. En PJ es el correo del representante legal (se guarda en el cliente como legalRepEmail si aún no lo tiene)',
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

  // ── Representante legal (solo PJ): es quien firma la autorización. Si la
  // identidad ya fue consultada antes, lo no enviado cae al Customer existente;
  // si aun así falta algo → 400.

  @ApiPropertyOptional({
    example: 'Juan Pérez',
    description: 'PJ: nombre del representante legal (firma la autorización)',
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

// El endpoint recibe la identificación a consultar (ConsultCreditBureauDto) +
// los datos de la solicitud. Consulta el bureau (crea/actualiza el Customer) y
// crea el CreditStudy en el mismo flujo; si el titular no ha firmado, envía el
// documento (a titularEmail) y devuelve 'authorization_pending' (no error) en
// vez de crear el estudio.
export class CreateStudyFromBureauDto extends IntersectionType(
  ConsultCreditBureauDto,
  StudyRequestDto,
) {}
