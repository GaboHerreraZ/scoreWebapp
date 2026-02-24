import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AutocompleteCustomerDto {
  @ApiPropertyOptional({
    example: 'ACME',
    description: 'Search term for customer business name',
    minLength: 1,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;
}
