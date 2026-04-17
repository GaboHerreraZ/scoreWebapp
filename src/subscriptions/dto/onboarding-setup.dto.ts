import {
  IsString,
  IsOptional,
  IsEmail,
  IsInt,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class OnboardingProfileDto {
  @ApiProperty({ example: 'Gabriel', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'Herrera', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  lastName: string;

  @ApiProperty({ example: 'herzar_620@hotmail.com', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: '+573001234567', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  phone: string;

  @ApiPropertyOptional({ example: 'Gerente', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  position?: string;

  @ApiProperty({
    example: 1,
    description: 'Parameter ID for identification type (CC, CE, NIT, etc.)',
  })
  @Type(() => Number)
  @IsInt()
  identificationTypeId: number;

  @ApiProperty({ example: '1035851234', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  identificationNumber: string;
}

class OnboardingCompanyDto {
  @ApiProperty({ example: 'Mi Empresa SAS', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '900123456-7', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  nit: string;

  @ApiProperty({ example: 1, description: 'Parameter ID for sector' })
  @Type(() => Number)
  @IsInt()
  sectorId: number;

  @ApiProperty({ example: 'Antioquia', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  state: string;

  @ApiProperty({ example: 'Medellín', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  city: string;

  @ApiProperty({ example: 'Calle 10 #30-45', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  address: string;
}

export class OnboardingSetupDto {
  @ApiProperty({ type: OnboardingProfileDto })
  @ValidateNested()
  @Type(() => OnboardingProfileDto)
  profile: OnboardingProfileDto;

  @ApiProperty({ type: OnboardingCompanyDto })
  @ValidateNested()
  @Type(() => OnboardingCompanyDto)
  company: OnboardingCompanyDto;
}
