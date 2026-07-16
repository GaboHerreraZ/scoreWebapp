import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateScoringDimensionDto {
  @ApiProperty({
    example: 'industryOutlook',
    description:
      'Code estable de la dimensión. Debe coincidir con una dimensión soportada por el motor.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Perspectiva del sector' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  label!: string;

  @ApiPropertyOptional({
    example: 'Evalúa el panorama del sector económico del cliente…',
    description: 'Qué mide la dimensión (se muestra al cliente como tooltip)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 8,
    description: 'Orden de display en el catálogo',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
