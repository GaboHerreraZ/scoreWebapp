import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'Plan Pro', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    example: 'Plan profesional con dashboard avanzado',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 149900,
    description: 'Subscription price in COP',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'true = monthly plan, false = annual plan',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isMonthly?: boolean;

  @ApiProperty({ example: 5, description: 'Maximum users' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsers: number;

  @ApiProperty({ example: 5, description: 'Maximum companies' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCompanies: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Maximum customers. Null = unlimited',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCustomers?: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Maximum credit studies per month. Null = unlimited',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxStudiesPerMonth?: number;

  @ApiProperty({
    example: 1,
    description: 'Dashboard level parameter ID (DASHBOARD_LEVEL)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dashboardLevelId: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  excelReports?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Enable email notifications (in addition to in-app)',
  })
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Allow theme customization',
  })
  @IsOptional()
  @IsBoolean()
  themeCustomization?: boolean;

  @ApiProperty({
    example: 1,
    description: 'Support level parameter ID (SUPPORT_LEVEL)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supportLevelId: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
