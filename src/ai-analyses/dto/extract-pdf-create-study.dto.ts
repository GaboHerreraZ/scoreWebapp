import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Datos que el usuario aporta al subir el PDF. Los datos financieros NO van
 * aqui: los extrae la IA del PDF. El endpoint lee el PDF una sola vez, extrae
 * datos + red flags de fiabilidad, y crea el estudio de credito de inmediato
 * (asi no se pierde la lectura si el usuario refresca la pantalla).
 *
 * Llega como multipart/form-data junto al archivo, por lo que los numericos
 * se transforman desde string con @Type.
 */
export class ExtractPdfCreateStudyDto {
  @ApiProperty({ example: 'customer-uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: '2026-06-08', description: 'Study date' })
  @IsDateString()
  studyDate: string;

  @ApiPropertyOptional({ example: 'Observaciones del estudio' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 60, description: 'Requested term (days)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requestedTerm?: number;

  @ApiPropertyOptional({
    example: 50000000,
    description: 'Requested total credit line',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  requestedCreditLine?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Income statement period parameter ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  incomeStatementId?: number;
}
