import {
  IsString,
  IsOptional,
  IsInt,
  IsEmail,
  MaxLength,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OnboardingProfileDto {
  @ApiPropertyOptional({ example: 'Gabriel', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: 'Herrera', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  lastName?: string;

  @ApiPropertyOptional({ example: '+573001234567', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({
    example: 104,
    description: 'Parameter ID tipo de documento',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  identificationTypeId?: number;

  @ApiPropertyOptional({ example: '1035851234', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  identificationNumber?: string;

  @ApiPropertyOptional({ example: 'Gerente', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  position?: string;
}

class OnboardingCompanyDto {
  @ApiProperty({ example: 'Acme S.A.S.', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '900123456-7', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  nit: string;

  @ApiProperty({ example: 12, description: 'Parameter ID del sector' })
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

  @ApiProperty({ example: 'Calle 1 #2-3', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  address: string;
}

class OnboardingBillingDto {
  @ApiProperty({ example: 'Gabriel', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  billingName: string;

  @ApiProperty({ example: 'Herrera', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  billingLastName: string;

  @ApiProperty({ example: 104, description: 'Parameter ID tipo de documento' })
  @Type(() => Number)
  @IsInt()
  billingDocTypeId: number;

  @ApiProperty({ example: '1035851234', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  billingDocNumber: string;

  @ApiProperty({ example: 'gabriel@acme.com', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  billingEmail: string;

  @ApiProperty({ example: '+573001234567', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  billingPhone: string;

  @ApiProperty({ example: 'Calle 10 #30-45', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  billingAddress: string;

  @ApiProperty({ example: 'Antioquia', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  billingState: string;

  @ApiProperty({ example: 'Medellín', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  billingCity: string;
}

export class OnboardingDto {
  @ApiProperty({ type: OnboardingProfileDto })
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingProfileDto)
  profile: OnboardingProfileDto;

  @ApiProperty({ type: OnboardingCompanyDto })
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingCompanyDto)
  company: OnboardingCompanyDto;

  @ApiProperty({ type: OnboardingBillingDto })
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingBillingDto)
  billing: OnboardingBillingDto;
}
