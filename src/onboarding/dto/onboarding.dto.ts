import {
  IsString,
  IsOptional,
  IsInt,
  IsEmail,
  MaxLength,
  ValidateNested,
  IsObject,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Perfil mínimo del onboarding: solo lo necesario para arrancar. Documento y
 * teléfono ya no se piden aquí (se siembran desde la facturación si es persona
 * natural, o se completan después desde Administración → Perfil).
 */
class OnboardingProfileDto {
  @ApiProperty({ example: 'Gabriel', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'Herrera', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  lastName: string;

  @ApiPropertyOptional({ example: 'Gerente', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  position?: string;
}

/**
 * La empresa nace solo con el nombre. NIT, sector, ciudad y dirección se
 * completan después en Administración → Empresa (gates por función: los
 * estudios exigen NIT; el pagaré, dirección y ciudad).
 */
class OnboardingCompanyDto {
  @ApiProperty({ example: 'Acme S.A.S.', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name: string;
}

class OnboardingBillingDto {
  @ApiPropertyOptional({
    example: 'Gabriel',
    maxLength: 150,
    description: 'Solo persona natural',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingName?: string;

  @ApiPropertyOptional({
    example: 'Herrera',
    maxLength: 150,
    description: 'Solo persona natural',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingLastName?: string;

  @ApiPropertyOptional({
    example: 'Acme S.A.S.',
    maxLength: 255,
    description: 'Razón social; solo persona jurídica (doc type NIT)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingBusinessName?: string;

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

  @ApiProperty({
    example: '05001',
    description: 'Código DANE del municipio de facturación (domicilio fiscal)',
    maxLength: 5,
  })
  @IsString()
  @MaxLength(5)
  billingCityCode: string;

  @ApiProperty({
    example: 104,
    description: "Régimen frente al IVA: id de un Parameter tipo 'tax_regime'",
  })
  @Type(() => Number)
  @IsInt()
  billingRegimeTypeId: number;

  @ApiProperty({
    example: ['R-99-PN'],
    isArray: true,
    description:
      "Responsabilidades fiscales: codes de Parameter tipo 'fiscal_responsibility' (son los códigos DIAN). Al menos una.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  billingFiscalResponsibilities: string[];
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

  @ApiPropertyOptional({
    example: 'JPEREZ',
    maxLength: 30,
    description:
      'Código de quien recomendó Creditia. Opcional. Si no existe se rechaza ' +
      'el registro con un mensaje claro, en vez de ignorarlo en silencio.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  salesRepCode?: string;
}
