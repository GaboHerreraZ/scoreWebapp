import {
  IsString,
  IsOptional,
  IsInt,
  IsEmail,
  IsUUID,
  IsDateString,
  IsNumber,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OnboardCompanyDto {
  @ApiProperty({ example: 'Acme S.A.' })
  @IsString()
  name: string;

  @ApiProperty({ example: '900123456-7' })
  @IsString()
  nit: string;

  @ApiProperty({ example: 12, description: 'Parameter ID del sector' })
  @Type(() => Number)
  @IsInt()
  sectorId: number;

  @ApiProperty({ example: 'Antioquia' })
  @IsString()
  state: string;

  @ApiProperty({ example: 'Medellín' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Calle 1 #2-3' })
  @IsString()
  address: string;

  // Facturación (opcional, para trazabilidad de los links de pago)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingLastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  billingDocTypeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingDocNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPhone?: string;
}

class OnboardSubscriptionDto {
  @ApiProperty({
    example: '3f7b1c2e-6d9a-4f41-9c52-2e8c5a7b9d13',
    description: 'UUID del plan a asignar (ej. el plan PRO), elegido en el portal',
  })
  @IsUUID()
  subscriptionId: string;

  @ApiProperty({ example: 10, description: 'Cupo mensual de estudios (nivel)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studiesPerMonth: number;

  @ApiProperty({ example: '2026-06-08', description: 'Inicio del contrato anual' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2027-06-08', description: 'Fin del contrato anual' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    example: 420000,
    description: 'Precio pactado (referencia/trazabilidad; el cobro es por fuera)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pricePaid?: number;
}

class OnboardOwnerDto {
  @ApiProperty({ example: 'dueno@acme.com' })
  @IsEmail()
  email: string;
}

export class OnboardClientDto {
  @ApiProperty({ type: OnboardCompanyDto })
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardCompanyDto)
  company: OnboardCompanyDto;

  @ApiProperty({ type: OnboardSubscriptionDto })
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardSubscriptionDto)
  subscription: OnboardSubscriptionDto;

  @ApiProperty({ type: OnboardOwnerDto })
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardOwnerDto)
  owner: OnboardOwnerDto;
}
