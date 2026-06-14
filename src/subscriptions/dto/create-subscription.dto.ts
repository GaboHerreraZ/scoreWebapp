import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'Plan Pro', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    example: 'Plan profesional con dashboard avanzado',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'true = monthly plan, false = annual plan',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isMonthly?: boolean;

  @ApiProperty({ example: 5, description: 'Maximum users' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsers: number;

  @ApiProperty({ example: 5, description: 'Maximum companies' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCompanies: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Maximum customers. Null = unlimited',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCustomers?: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Maximum credit studies per month. Null = unlimited',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxStudiesPerMonth?: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Maximum AI analyses per month. Null = unlimited',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAiAnalysisPerMonth?: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Maximum PDF extractions per month. Null = unlimited',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPdfExtractionsPerMonth?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'true = crear un plan recurrente en ePayco con el monto (estudios × precio de consulta vigente) y guardar su id_plan; false = plan dinámico, el plan ePayco se crea por empresa en el onboarding. Requiere maxStudiesPerMonth > 0.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isEpaycoPlan?: boolean;
}
