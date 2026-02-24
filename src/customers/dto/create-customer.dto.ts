import {
  IsString,
  IsOptional,
  IsInt,
  IsEmail,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @ApiProperty({ example: 1, description: 'Person type parameter ID' })
  @Type(() => Number)
  @IsInt()
  personTypeId: number;

  @ApiProperty({ example: 'Comercializadora XYZ S.A.S.', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  businessName: string;

  @ApiProperty({ example: '900987654-1', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  identificationNumber: string;

  @ApiPropertyOptional({ example: 'Juan Pérez', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalRepName?: string;

  @ApiPropertyOptional({ example: '1020304050', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepId?: string;

  @ApiPropertyOptional({ example: 1, description: 'Economic activity parameter ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  economicActivityId?: number;

  @ApiPropertyOptional({ example: 'contacto@xyz.com', maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ example: '3001234567', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: '3109876543', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  secondaryPhone?: string;

  @ApiPropertyOptional({ example: 'Medellín', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  city?: string;

  @ApiPropertyOptional({ example: 'Carrera 50 #30-10', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: 5, description: 'Seniority in years' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  seniority?: number;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  commercialRef1Name?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  commercialRef1Contact?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  commercialRef1Phone?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  commercialRef2Name?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  commercialRef2Contact?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  commercialRef2Phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observations?: string;
}
