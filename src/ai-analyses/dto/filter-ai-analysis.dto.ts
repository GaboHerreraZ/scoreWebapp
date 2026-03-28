import { IsOptional, IsUUID, IsString, IsInt } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterAiAnalysisDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by customer ID' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Filter by credit study ID' })
  @IsOptional()
  @IsUUID()
  creditStudyId?: string;

  @ApiPropertyOptional({ description: 'Filter by status (success | error)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by analysis type parameter ID' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  typeId?: number;
}
