import { IsOptional, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterInvitationDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status parameter ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusId?: number;
}
