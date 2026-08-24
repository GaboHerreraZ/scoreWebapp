import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  IsString,
  IsEmail,
  MaxLength,
  Matches,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateCompanyDto } from './create-company.dto.js';

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
  @ApiPropertyOptional({
    example: 10,
    description: 'Account type parameter ID (Ahorros, Corriente)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accountTypeId?: number;

  @ApiPropertyOptional({
    example: 15,
    description: 'Bank parameter ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accountBankId?: number;

  @ApiPropertyOptional({
    example: '001234567890',
    description: 'Bank account number (string to preserve leading zeros)',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^\d+$/, { message: 'accountNumber must contain only digits' })
  accountNumber?: string;

  // ─── Representante legal (quien obliga a la empresa) ────

  @ApiPropertyOptional({ example: 'María Gómez Rojas', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalRepName?: string;

  @ApiPropertyOptional({
    example: 104,
    description: 'Parameter ID tipo de documento del representante legal',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  legalRepIdentificationTypeId?: number;

  @ApiPropertyOptional({ example: '1035851234', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepIdentificationNumber?: string;

  @ApiPropertyOptional({
    example: 'maria.gomez@acme.com',
    maxLength: 255,
    description: 'Correo de contacto del representante legal',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  legalRepEmail?: string;

  @ApiPropertyOptional({ example: '+573001234567', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepPhone?: string;

  // ─── Billing fields ───────────────────────────────────────

  @ApiPropertyOptional({ example: 'Juan', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingName?: string;

  @ApiPropertyOptional({ example: 'Pérez', maxLength: 150 })
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

  @ApiPropertyOptional({
    example: 5,
    description: 'Billing document type parameter ID (CC, CE, NIT, etc.)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  billingDocTypeId?: number;

  @ApiPropertyOptional({ example: '900123456', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  billingDocNumber?: string;

  @ApiPropertyOptional({ example: 'billing@empresa.com', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingEmail?: string;

  @ApiPropertyOptional({ example: 'Cra 10 # 20-30', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingAddress?: string;

  @ApiPropertyOptional({
    example: '11001',
    description: 'Código DANE del municipio de facturación (domicilio fiscal)',
    maxLength: 5,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  billingCityCode?: string;

  @ApiPropertyOptional({ example: '3001234567', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  billingPhone?: string;

  @ApiPropertyOptional({
    example: 104,
    description: "Régimen frente al IVA: id de un Parameter tipo 'tax_regime'",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  billingRegimeTypeId?: number;

  @ApiPropertyOptional({
    example: ['R-99-PN'],
    isArray: true,
    description:
      "Responsabilidades fiscales: codes de Parameter tipo 'fiscal_responsibility'",
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  billingFiscalResponsibilities?: string[];
}
