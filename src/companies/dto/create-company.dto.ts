import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Empresa ABC S.A.S.', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '900123456-7', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  nit: string;

  @ApiProperty({ example: 1, description: 'Sector parameter ID' })
  @Type(() => Number)
  @IsInt()
  sectorId: number;

  @ApiProperty({
    example: '11001',
    description:
      'Código DANE del municipio (dane_cities). El departamento son los 2 primeros dígitos.',
    maxLength: 5,
  })
  @IsString()
  @MaxLength(5)
  cityCode: string;

  @ApiProperty({ example: 'Calle 100 #15-20', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  address: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
