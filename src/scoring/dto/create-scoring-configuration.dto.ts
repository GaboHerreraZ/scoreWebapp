import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ScoringWeightItemDto {
  @ApiProperty({
    example: 'paymentCapacity',
    description:
      'Code de la dimensión en el catálogo scoring_dimensions (debe estar activa)',
  })
  @IsString()
  @IsNotEmpty()
  dimension!: string;

  @ApiProperty({
    example: 20,
    description: 'Peso de la dimensión (entero, >= MIN_WEIGHT)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  weight!: number;
}

export class CreateScoringConfigurationDto {
  @ApiProperty({
    type: [ScoringWeightItemDto],
    description:
      'Dimensiones habilitadas con su peso. Las ausentes quedan deshabilitadas y no participan del estudio.',
    example: [
      { dimension: 'paymentCapacity', weight: 30 },
      { dimension: 'centralRisk', weight: 30 },
      { dimension: 'financialHealth', weight: 25 },
      { dimension: 'veracity', weight: 15 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ScoringWeightItemDto)
  weights!: ScoringWeightItemDto[];
}
