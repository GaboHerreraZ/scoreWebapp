import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateScoringDimensionDto {
  @ApiPropertyOptional({ example: 'Salud financiera' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  label?: string;

  @ApiPropertyOptional({
    description: 'Qué mide la dimensión (se muestra al cliente como tooltip)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Orden de display en el catálogo',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'Eliminación lógica / reactivación. Una dimensión obligatoria del motor no puede desactivarse.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
