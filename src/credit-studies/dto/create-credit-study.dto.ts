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

// Las cifras de estados financieros (balance/EERR) ya NO se envían al crear un
// estudio: viven en FinancialStatement (colgando del Customer) y el estudio las
// referencia vía la join. Este DTO cubre solo identidad, solicitud y notas.
export class CreateCreditStudyDto {
  @ApiProperty({ example: 'customer-uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: '2026-02-11', description: 'Study date' })
  @IsDateString()
  studyDate: string;

  @ApiPropertyOptional({
    example: '2026-03-01',
    description: 'Resolution date',
  })
  @IsOptional()
  @IsDateString()
  resolutionDate?: string;

  @ApiPropertyOptional({ example: 'Study observations' })
  @IsOptional()
  @IsString()
  notes?: string;

  // ── Solicitud ──────────────────────────────────────────

  @ApiPropertyOptional({ example: 12, description: 'Requested term (months)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requestedTerm?: number;

  @ApiPropertyOptional({
    example: 50000000,
    description: 'Requested monthly credit line',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  requestedCreditLine?: number;
}
