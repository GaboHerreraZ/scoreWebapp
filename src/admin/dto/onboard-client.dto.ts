import {
  IsString,
  IsInt,
  IsEmail,
  IsUUID,
  IsDateString,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

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

  // Facturación: requerida porque el pago del onboarding la usa para crear el
  // cliente y la suscripción en ePayco (se valida de nuevo en payOnboarding).
  @ApiProperty({ example: 'Gabriel' })
  @IsString()
  billingName: string;

  @ApiProperty({ example: 'Herrera' })
  @IsString()
  billingLastName: string;

  @ApiProperty({ example: 104, description: 'Parameter ID del tipo de documento' })
  @IsInt()
  @Type(() => Number)
  billingDocTypeId: number;

  @ApiProperty({ example: '1035851234' })
  @IsString()
  billingDocNumber: string;

  @ApiProperty({ example: 'cliente@empresa.com' })
  @IsEmail()
  billingEmail: string;

  @ApiProperty({ example: '+573001234567' })
  @IsString()
  billingPhone: string;

  @ApiProperty({ example: 'Calle 10 #30-45' })
  @IsString()
  billingAddress: string;

  @ApiProperty({ example: 'Antioquia' })
  @IsString()
  billingState: string;

  @ApiProperty({ example: 'Medellín' })
  @IsString()
  billingCity: string;
}

class OnboardSubscriptionDto {
  @ApiProperty({
    example: '3f7b1c2e-6d9a-4f41-9c52-2e8c5a7b9d13',
    description:
      'UUID del plan a asignar (ej. el plan PRO), elegido en el portal',
  })
  @IsUUID()
  subscriptionId: string;

  @ApiProperty({ example: 10, description: 'Cupo mensual de estudios (nivel)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studiesPerMonth: number;

  @ApiProperty({ example: 3, description: 'Máximo de usuarios de la empresa' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsers: number;

  @ApiProperty({ example: 5, description: 'Máximo de clientes (customers)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCustomers: number;

  @ApiProperty({ example: 20, description: 'Máximo de análisis con IA al mes' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAiAnalysisPerMonth: number;

  @ApiProperty({
    example: 15,
    description: 'Máximo de extracciones de PDF al mes',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxPdfExtractionsPerMonth: number;

  @ApiProperty({
    example: '2026-06-08',
    description: 'Inicio del contrato anual',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2027-06-08', description: 'Fin del contrato anual' })
  @IsDateString()
  endDate: string;
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
