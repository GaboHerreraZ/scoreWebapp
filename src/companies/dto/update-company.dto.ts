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
}
