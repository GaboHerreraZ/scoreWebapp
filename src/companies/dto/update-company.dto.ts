import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, IsString, MaxLength, Matches } from 'class-validator';
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

  @ApiPropertyOptional({ example: 'Cundinamarca', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingState?: string;

  @ApiPropertyOptional({ example: 'Bogotá', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingCity?: string;

  @ApiPropertyOptional({ example: '3001234567', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  billingPhone?: string;
}
