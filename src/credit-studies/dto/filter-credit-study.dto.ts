import { IsOptional, IsInt, IsUUID, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterCreditStudyDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by customer' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filter by status' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusId?: number;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Study date from' })
  @IsOptional()
  @IsDateString()
  studyDateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Study date to' })
  @IsOptional()
  @IsDateString()
  studyDateTo?: string;
}
