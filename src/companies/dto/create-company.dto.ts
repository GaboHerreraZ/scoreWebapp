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

  @ApiProperty({ example: 'Cundinamarca', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  state: string;

  @ApiProperty({ example: 'Bogotá', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  city: string;

  @ApiProperty({ example: 'Calle 100 #15-20', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  address: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ example: 1, description: 'Role parameter ID for the user-company association' })
  @Type(() => Number)
  @IsInt()
  roleId: number;
}
