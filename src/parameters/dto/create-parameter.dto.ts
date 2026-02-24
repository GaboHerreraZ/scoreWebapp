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

export class CreateParameterDto {
  @ApiProperty({ example: 'SUBSCRIPTION_TYPE', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  type: string;

  @ApiProperty({ example: 'BASIC', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: 'Plan Básico', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  label: string;

  @ApiPropertyOptional({ example: 'Plan básico con funciones limitadas', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parentId?: number;
}
