import { IsOptional, IsInt } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterCustomerDto extends PaginationDto {
  @ApiPropertyOptional({ example: 1, description: 'Filter by person type' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  personTypeId?: number;
}
