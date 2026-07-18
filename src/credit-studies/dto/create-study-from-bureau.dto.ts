import { IntersectionType } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
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
  @ApiProperty({
    example: 'titular@correo.com',
    description: 'Correo del titular; es el firmante de la autorización',
  })
  @IsEmail()
  @MaxLength(255)
  titularEmail: string;
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
