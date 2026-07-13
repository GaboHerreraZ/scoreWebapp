import { IntersectionType } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ConsultCreditBureauDto } from '../../credit-bureau/dto/consult-credit-bureau.dto.js';

// Datos de la solicitud del estudio (lo único que el usuario aporta; el resto
// del estudio queda null hasta que se realice). studyDate NO se pide: se setea
// a hoy al crear.
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
}

// El endpoint recibe la identificación a consultar (ConsultCreditBureauDto) +
// los datos de la solicitud. Consulta el bureau (crea/actualiza el Customer) y
// crea el CreditStudy en el mismo flujo.
export class CreateStudyFromBureauDto extends IntersectionType(
  ConsultCreditBureauDto,
  StudyRequestDto,
) {}
