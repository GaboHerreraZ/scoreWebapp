import {
  IsOptional,
  IsInt,
  IsDateString,
  IsString,
  IsNumber,
  IsIn,
  IsBoolean,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateCompanySubscriptionDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'ID del parámetro de estado',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusId?: number;

  @ApiPropertyOptional({
    example: '2027-06-01',
    description: 'Nueva fecha de fin',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    example: 'annual',
    enum: ['monthly', 'annual'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'annual'])
  paymentFrequency?: string;

  @ApiPropertyOptional({ example: 119900 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePaid?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
